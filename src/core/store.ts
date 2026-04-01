import { create } from "zustand";
import type { Project, Session, Settings, SplitLayout } from "./types";
import { defaultTerminal } from "../lib/platform";
import { detectSystemLanguage } from "../i18n/i18n";
import { loadData, debouncedSave } from "./persistence";
import { pty, scrollback, bookmarks as bookmarksApi, terminal as terminalApi, listen } from "./api";

// Internal state — not in Zustand (no re-renders needed), but grouped for clarity and testability
const _internal = {
  watcherReady: false,
  skillScanInterval: null as ReturnType<typeof setInterval> | null,

  /** Reset internal state (for testing) */
  reset() {
    _internal.watcherReady = false;
    if (_internal.skillScanInterval) {
      clearInterval(_internal.skillScanInterval);
      _internal.skillScanInterval = null;
    }
  },
};

// Exported for test assertions only
export { _internal };

// --- Helpers ---

/** Filter out bookmarks that already exist (by prompt), return new ones with IDs */
function dedupeNewBookmarks(
  incoming: { name: string; prompt: string; description?: string }[],
  existing: { prompt: string }[],
): { id: string; name: string; prompt: string; description?: string }[] {
  const existingPrompts = new Set(existing.map((b) => b.prompt));
  return incoming
    .filter((p) => !existingPrompts.has(p.prompt))
    .map((p) => ({ id: uid(), name: p.name, prompt: p.prompt, description: p.description }));
}

// --- Bookmark event listeners (Rust watcher emits these) ---

async function setupBookmarkListeners() {
  if (_internal.watcherReady) return;
  _internal.watcherReady = true;
  try {
    await listen<string>("bookmark-pending", (payload) => {
      try {
        const parsed = JSON.parse(payload);
        if (!Array.isArray(parsed)) return;
        const pending = parsed.filter(
          (p: Record<string, unknown>) => typeof p.name === "string" && typeof p.prompt === "string",
        );
        if (pending.length === 0) return;
        const s = useStore.getState();
        const proj = s.projects.find((p) => p.id === s.activePid);
        if (!proj) return;
        const currentBookmarks = proj.bookmarks ?? [];
        const newBookmarks = dedupeNewBookmarks(pending, currentBookmarks);
        if (newBookmarks.length === 0) return;
        const bookmarks = [...currentBookmarks, ...newBookmarks];
        const projects = s.projects.map((p) =>
          p.id === s.activePid ? { ...p, bookmarks } : p
        );
        persist({ ...s, projects });
        useStore.setState({ projects });
      } catch (err) { import("../lib/logger").then(({ logger }) => logger.warn("store", `bookmark-pending parse error: ${err}`)); }
    });

    await listen<string>("bookmark-scores", (payload) => {
      try {
        const scores: Record<string, number> = JSON.parse(payload);
        if (!scores || typeof scores !== "object" || Array.isArray(scores)) return;
        useStore.setState({ bookmarkScores: scores });
        const s = useStore.getState();
        const proj = s.projects.find((p) => p.id === s.activePid);
        if (!proj) return;
        const currentBookmarks = proj.bookmarks ?? [];
        const bookmarks = [...currentBookmarks].sort((a, b) => {
          const sa = scores[a.prompt] ?? 0;
          const sb = scores[b.prompt] ?? 0;
          return sb - sa;
        });
        if (bookmarks.every((b, i) => b.id === currentBookmarks[i]?.id)) return;
        const projects = s.projects.map((p) =>
          p.id === s.activePid ? { ...p, bookmarks } : p
        );
        persist({ ...s, projects });
        useStore.setState({ projects });
      } catch (err) { import("../lib/logger").then(({ logger }) => logger.warn("store", `bookmark-scores parse error: ${err}`)); }
    });
  } catch {
    // Not in Tauri — skip
  }
}

// --- Session state detection (global listener) ---

interface SessionStateData {
  session_id: string;
  state: string;
  ts: number;
  tool?: string;
  changed_files?: string[];
}

const _prevSessionStates: Record<string, string> = {};

async function setupSessionStateListener() {
  try {
    await listen<string>("session-state-changed", (raw) => {
      try {
        const data = JSON.parse(raw) as SessionStateData;
        if (!data.session_id || !data.state) return;

        const store = useStore.getState();

        // Find matching session + project across ALL projects
        let matchedSid: string | null = null;
        let matchedProject: Project | null = null;
        let matchedSession: Session | null = null;
        for (const p of store.projects) {
          const s = p.sessions.find((s) => s.claudeSessionId === data.session_id);
          if (s) { matchedSid = s.id; matchedProject = p; matchedSession = s; break; }
        }
        if (!matchedSid || !matchedProject || !matchedSession) return;

        const prev = _prevSessionStates[data.session_id];
        if (prev === data.state) return;
        _prevSessionStates[data.session_id] = data.state;

        store.setSessionState(data.session_id, data.state as "working" | "idle" | "waiting");
        if (data.tool) store.setSessionTool(data.session_id, data.tool);
        if (data.changed_files && data.changed_files.length > 0) {
          store.setSessionChangedFiles(data.session_id, data.changed_files);
        }

        if (data.state === "idle" && prev === "working") {
          if (store.activeSid !== matchedSid) {
            terminalApi.notifyDone(`${matchedProject.name} — ${matchedSession.name}`);
          }
        }
      } catch (err) { import("../lib/logger").then(({ logger }) => logger.warn("store", `session-state parse error: ${err}`)); }
    });
  } catch {
    // Not in Tauri — skip
  }
}

// --- Skill auto-scan ---

interface SkillInfo {
  name: string;
  description?: string;
  prompt: string;
}

async function scanAndImportSkills(projectDir: string) {
  try {
    const skills: SkillInfo[] = await bookmarksApi.scanSkills(projectDir);
    if (skills.length === 0) return;

    const s = useStore.getState();
    const proj = s.projects.find((p) => p.dir === projectDir);
    if (!proj) return;

    const currentBookmarks = proj.bookmarks ?? [];
    const newBookmarks = dedupeNewBookmarks(skills, currentBookmarks);
    if (newBookmarks.length === 0) return;
    const bookmarks = [...currentBookmarks, ...newBookmarks];
    const projects = s.projects.map((p) =>
      p.id === proj.id ? { ...p, bookmarks } : p
    );
    persist({ ...s, projects });
    useStore.setState({ projects });
  } catch (err) {
    import("../lib/logger").then(({ logger }) => logger.warn("store", `skill scan failed: ${err}`));
  }
}

// --- Scrollback persistence (delegates to Rust backend via api.ts) ---

function clearScrollback(sessionId: string) {
  scrollback.clear(sessionId);
}

// --- Helpers ---

function uid(): string {
  return crypto.randomUUID();
}

function makeSession(name: string, type?: import("./types").SessionType): Session {
  return { id: uid(), name, type: type ?? "claude" };
}

function makeProject(name: string, dir: string): Project {
  return { id: uid(), name, dir, sessions: [makeSession("main")] };
}

// --- Store ---

interface AppStore {
  projects: Project[];
  activePid: string;
  activeSid: string;
  settings: Settings;
  loaded: boolean;
  sessionStates: Record<string, "working" | "idle" | "waiting">; // claudeSessionId -> state
  sessionTools: Record<string, string>; // claudeSessionId -> last tool used
  sessionChangedFiles: Record<string, string[]>; // claudeSessionId -> changed file paths
  bookmarkScores: Record<string, number>; // prompt -> score (from hook)
  projectSessions: Record<string, string>; // pid -> derniere session active (non persiste)
  sessionCosts: Record<string, number>;
  splitLayout: SplitLayout;
  focusedPane: "primary" | "secondary";
  init: () => Promise<void>;

  addProject: (name: string, dir: string) => void;
  renameProject: (pid: string, name: string) => void;
  removeProject: (pid: string) => void;
  setActiveProject: (pid: string) => void;

  addSession: (name?: string, type?: import("./types").SessionType) => void;
  renameSession: (sid: string, name: string) => void;
  removeSession: (sid: string) => void;
  setActiveSession: (sid: string) => void;

  reorderSession: (sid: string, targetSid: string) => void;

  setSessionState: (claudeSessionId: string, state: "working" | "idle" | "waiting") => void;
  setSessionTool: (claudeSessionId: string, tool: string) => void;
  setSessionChangedFiles: (claudeSessionId: string, files: string[]) => void;

  updateSessionCost: (sid: string, cost: number) => void;
  setClaudeSessionId: (sid: string, claudeId: string) => void;
  setDangerousMode: (sid: string, on: boolean) => void;

  setSidebarWidth: (w: number) => void;
  setTerminal: (t: Settings["terminal"]) => void;
  setEditor: (e: Settings["editor"]) => void;
  setTheme: (t: Settings["theme"]) => void;
  setFontSize: (s: number) => void;
  setAnalytics: (on: boolean) => void;
  setAutoUpdate: (on: boolean) => void;
  setDefaultMode: (mode: import("./types").SessionMode) => void;
  setLanguage: (lang: import("./types").Language) => void;
  setStatuslineAsked: () => void;

  // Bookmarks
  addBookmark: (name: string, prompt: string) => void;
  removeBookmark: (id: string) => void;
  updateBookmark: (id: string, name: string, prompt: string) => void;

  // Split pane
  splitSession: (secondarySid: string) => void;
  unsplit: () => void;
  setFocusedPane: (pane: "primary" | "secondary") => void;
  setSplitRatio: (ratio: number) => void;

}

function persist(state: AppStore) {
  debouncedSave({
    projects: state.projects,
    activePid: state.activePid,
    activeSid: state.activeSid,
    settings: state.settings,
  });
}

export const useStore = create<AppStore>((set, get) => ({
  projects: [],
  activePid: "",
  activeSid: "",
  settings: {
    terminal: defaultTerminal as Settings["terminal"],
    editor: "vscode" as Settings["editor"],
    theme: "orbit",
    fontSize: 11,
    sidebarWidth: 200,
    analytics: true,
    statuslineAsked: false,
    autoUpdate: true,
    defaultMode: "normal" as const,
    language: detectSystemLanguage(),
  },
  loaded: false,
  sessionStates: {},
  sessionTools: {},
  sessionChangedFiles: {},
  bookmarkScores: {},
  projectSessions: {},
  sessionCosts: {},
  splitLayout: { type: "none", primarySid: "", ratio: 0.5 },
  focusedPane: "primary",
  init: async () => {
    const data = await loadData();
    if (data && data.projects.length > 0) {
      // Migrate top-level bookmarks into the active project (backward compat)
      let projects = data.projects;
      if (data.bookmarks && data.bookmarks.length > 0) {
        const activeProj = projects.find((p) => p.id === data.activePid);
        if (activeProj && (!activeProj.bookmarks || activeProj.bookmarks.length === 0)) {
          projects = projects.map((p) =>
            p.id === data.activePid
              ? { ...p, bookmarks: data.bookmarks }
              : p
          );
        }
      }
      set({
        projects,
        activePid: data.activePid,
        activeSid: data.activeSid,
        settings: { ...get().settings, ...data.settings },
        loaded: true,
      });
    } else {
      // No data — show onboarding (create first project)
      set({ loaded: true });
    }
    // Setup watcher-based event listeners (replaces polling)
    await setupBookmarkListeners();
    await setupSessionStateListener();
    // Auto-scan skills for active project
    const activeProj2 = get().projects.find((p) => p.id === get().activePid);
    if (activeProj2) {
      scanAndImportSkills(activeProj2.dir);
    }
    // Rescan skills every 60s (lightweight, local files only)
    if (_internal.skillScanInterval) clearInterval(_internal.skillScanInterval);
    _internal.skillScanInterval = setInterval(() => {
      if (typeof document !== "undefined" && !document.hasFocus()) return;
      const s = get();
      const proj = s.projects.find((p) => p.id === s.activePid);
      if (proj) scanAndImportSkills(proj.dir);
    }, 60000);
  },

  addProject: (name, dir) => {
    set((s) => {
      const p = makeProject(name, dir);
      const next = {
        projects: [...s.projects, p],
        activePid: p.id,
        activeSid: p.sessions[0].id,
      };
      persist({ ...s, ...next });
      return next;
    });
    // Auto-scan skills for new project
    scanAndImportSkills(dir);
  },

  renameProject: (pid, name) =>
    set((s) => {
      const projects = s.projects.map((p) =>
        p.id === pid ? { ...p, name } : p
      );
      persist({ ...s, projects });
      return { projects };
    }),

  removeProject: (pid) => {
    // Kill PTYs BEFORE updating state to prevent race
    const state = get();
    const removed = state.projects.find((p) => p.id === pid);
    if (removed) {
      for (const session of removed.sessions) {
        pty.killSilent(session.id);
        clearScrollback(session.id);
      }
    }
    set((s) => {
      const projects = s.projects.filter((p) => p.id !== pid);
      if (projects.length === 0) return s;
      const needSwitch = s.activePid === pid;
      const activePid = needSwitch ? projects[0].id : s.activePid;
      const activeSid = needSwitch
        ? projects[0].sessions[0].id
        : s.activeSid;
      const next = { projects, activePid, activeSid };
      persist({ ...s, ...next });
      return next;
    });
  },

  setActiveProject: (pid) => {
    const proj = get().projects.find((p) => p.id === pid);
    if (!proj) return;
    set((s) => {
      const remembered = s.projectSessions[pid];
      const activeSid = proj.sessions.find((ss) => ss.id === remembered)
        ? remembered
        : proj.sessions[0].id;
      const next = { activePid: pid, activeSid };
      persist({ ...s, ...next });
      return next;
    });
    // Scan skills when switching project
    scanAndImportSkills(proj.dir);
  },

  addSession: (name, type) =>
    set((s) => {
      const proj = s.projects.find((p) => p.id === s.activePid);
      if (!proj) return s;
      const count = proj.sessions.length + 1;
      const defaultName = type === "terminal" ? `terminal-${count}` : `session-${count}`;
      const session = makeSession(name || defaultName, type);
      const projects = s.projects.map((p) =>
        p.id === s.activePid
          ? { ...p, sessions: [...p.sessions, session] }
          : p
      );
      const next = { projects, activeSid: session.id };
      persist({ ...s, ...next });
      return next;
    }),

  renameSession: (sid, name) =>
    set((s) => {
      const projects = s.projects.map((p) => ({
        ...p,
        sessions: p.sessions.map((ss) =>
          ss.id === sid ? { ...ss, name } : ss
        ),
      }));
      persist({ ...s, projects });
      return { projects };
    }),

  reorderSession: (sid, targetSid) =>
    set((s) => {
      const proj = s.projects.find((p) => p.id === s.activePid);
      if (!proj || sid === targetSid) return s;
      const sessions = [...proj.sessions];
      const fromIdx = sessions.findIndex((ss) => ss.id === sid);
      const toIdx = sessions.findIndex((ss) => ss.id === targetSid);
      if (fromIdx === -1 || toIdx === -1) return s;
      const [moved] = sessions.splice(fromIdx, 1);
      sessions.splice(toIdx, 0, moved);
      const projects = s.projects.map((p) =>
        p.id === s.activePid ? { ...p, sessions } : p
      );
      persist({ ...s, projects });
      return { projects };
    }),

  removeSession: (sid) => {
    // Guard first: only kill PTY if the session can actually be removed
    const current = get();
    const currentProj = current.projects.find((p) => p.id === current.activePid);
    if (!currentProj || currentProj.sessions.length <= 1) return;
    // Kill PTY BEFORE state update to prevent race with new spawn
    pty.killSilent(sid);
    clearScrollback(sid);
    set((s) => {
      const proj = s.projects.find((p) => p.id === s.activePid);
      if (!proj || proj.sessions.length <= 1) return s;
      let activeSid = s.activeSid;
      if (s.activeSid === sid) {
        const idx = proj.sessions.findIndex((ss) => ss.id === sid);
        const neighbor = idx > 0 ? idx - 1 : 1;
        activeSid = proj.sessions[neighbor].id;
      }
      const sessions = proj.sessions.filter((ss) => ss.id !== sid);
      const projects = s.projects.map((p) =>
        p.id === s.activePid ? { ...p, sessions } : p
      );
      const next = { projects, activeSid };
      persist({ ...s, ...next });
      return next;
    });
  },

  setActiveSession: (sid) =>
    set((s) => {
      persist({ ...s, activeSid: sid });
      return {
        activeSid: sid,
        projectSessions: { ...s.projectSessions, [s.activePid]: sid },
      };
    }),

  setSessionState: (claudeSessionId, state) =>
    set((s) => ({
      sessionStates: { ...s.sessionStates, [claudeSessionId]: state },
    })),

  setSessionTool: (claudeSessionId, tool) =>
    set((s) => ({
      sessionTools: { ...s.sessionTools, [claudeSessionId]: tool },
    })),

  setSessionChangedFiles: (claudeSessionId, files) =>
    set((s) => ({
      sessionChangedFiles: { ...s.sessionChangedFiles, [claudeSessionId]: files },
    })),

  updateSessionCost: (sid, cost) =>
    set((s) => ({
      sessionCosts: { ...s.sessionCosts, [sid]: cost },
    })),

  setClaudeSessionId: (sid, claudeId) =>
    set((s) => {
      const projects = s.projects.map((p) => ({
        ...p,
        sessions: p.sessions.map((ss) =>
          ss.id === sid ? { ...ss, claudeSessionId: claudeId } : ss
        ),
      }));
      persist({ ...s, projects });
      return { projects };
    }),

  setDangerousMode: (sid, on) =>
    set((s) => {
      const projects = s.projects.map((p) => ({
        ...p,
        sessions: p.sessions.map((ss) =>
          ss.id === sid ? { ...ss, dangerousMode: on } : ss
        ),
      }));
      persist({ ...s, projects });
      return { projects };
    }),

  setSidebarWidth: (w) =>
    set((s) => {
      const settings = { ...s.settings, sidebarWidth: w };
      persist({ ...s, settings });
      return { settings };
    }),

  setTerminal: (t) =>
    set((s) => {
      const settings = { ...s.settings, terminal: t };
      persist({ ...s, settings });
      return { settings };
    }),

  setEditor: (e) =>
    set((s) => {
      const settings = { ...s.settings, editor: e };
      persist({ ...s, settings });
      return { settings };
    }),

  setTheme: (t) =>
    set((s) => {
      const settings = { ...s.settings, theme: t };
      persist({ ...s, settings });
      return { settings };
    }),

  setFontSize: (size) =>
    set((s) => {
      const clamped = Math.max(8, Math.min(20, size));
      const settings = { ...s.settings, fontSize: clamped };
      persist({ ...s, settings });
      return { settings };
    }),

  setAnalytics: (on) =>
    set((s) => {
      const settings = { ...s.settings, analytics: on };
      persist({ ...s, settings });
      return { settings };
    }),

  setAutoUpdate: (on) =>
    set((s) => {
      const settings = { ...s.settings, autoUpdate: on };
      persist({ ...s, settings });
      return { settings };
    }),

  setDefaultMode: (mode) =>
    set((s) => {
      const settings = { ...s.settings, defaultMode: mode };
      persist({ ...s, settings });
      return { settings };
    }),

  setLanguage: (lang) =>
    set((s) => {
      const settings = { ...s.settings, language: lang };
      persist({ ...s, settings });
      return { settings };
    }),

  setStatuslineAsked: () =>
    set((s) => {
      const settings = { ...s.settings, statuslineAsked: true };
      persist({ ...s, settings });
      return { settings };
    }),

  // Bookmarks (per-project)
  addBookmark: (name, prompt) =>
    set((s) => {
      const proj = s.projects.find((p) => p.id === s.activePid);
      if (!proj) return s;
      const bookmarks = [...(proj.bookmarks ?? []), { id: uid(), name, prompt }];
      const projects = s.projects.map((p) =>
        p.id === s.activePid ? { ...p, bookmarks } : p
      );
      persist({ ...s, projects });
      return { projects };
    }),

  removeBookmark: (id) =>
    set((s) => {
      const proj = s.projects.find((p) => p.id === s.activePid);
      if (!proj) return s;
      const bookmarks = (proj.bookmarks ?? []).filter((b) => b.id !== id);
      const projects = s.projects.map((p) =>
        p.id === s.activePid ? { ...p, bookmarks } : p
      );
      persist({ ...s, projects });
      return { projects };
    }),

  updateBookmark: (id, name, prompt) =>
    set((s) => {
      const proj = s.projects.find((p) => p.id === s.activePid);
      if (!proj) return s;
      const bookmarks = (proj.bookmarks ?? []).map((b) =>
        b.id === id ? { ...b, name, prompt } : b
      );
      const projects = s.projects.map((p) =>
        p.id === s.activePid ? { ...p, bookmarks } : p
      );
      persist({ ...s, projects });
      return { projects };
    }),

  // importPendingBookmarks/applyBookmarkScores — now handled by Rust watcher events

  // Split pane
  splitSession: (secondarySid) =>
    set((s) => ({
      splitLayout: {
        type: "vertical",
        primarySid: s.activeSid,
        secondarySid,
        ratio: 0.5,
      },
    })),

  unsplit: () =>
    set(() => ({
      splitLayout: { type: "none", primarySid: "", ratio: 0.5 },
      focusedPane: "primary",
    })),

  setFocusedPane: (pane) =>
    set(() => ({ focusedPane: pane })),

  setSplitRatio: (ratio) =>
    set((s) => ({
      splitLayout: { ...s.splitLayout, ratio },
    })),


}));

// --- Selectors (reusable across components) ---

/** Select the active project */
export const selectActiveProject = (s: AppStore) =>
  s.projects.find((p) => p.id === s.activePid);

/** Select the active session */
export const selectActiveSession = (s: AppStore) => {
  const proj = s.projects.find((p) => p.id === s.activePid);
  return proj?.sessions.find((ss) => ss.id === s.activeSid);
};
