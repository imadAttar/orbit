import { create } from "zustand";
import type { Project, Session, Settings } from "./types";
import { defaultTerminal } from "../lib/platform";
import { detectSystemLanguage } from "../i18n/i18n";
import { loadData, debouncedSave } from "./persistence";
import { pty, scrollback, terminal as terminalApi, listen } from "./api";

// Track freshly created session IDs — these skip scrollback check on first mount
export const freshSessionIds = new Set<string>();

// --- Session state detection (global listener) ---

interface SessionStateData {
  session_id: string;
  state: string;
  ts: number;
  tool?: string;
  transcript_path?: string;
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
        if (data.state === "idle" && prev === "working") {
          if (store.activeSid !== matchedSid) {
            terminalApi.notifyDone(`${matchedProject.name} — ${matchedSession.name}`);
            window.dispatchEvent(new CustomEvent("session-completed", {
              detail: { sessionId: matchedSid, projectId: matchedProject.id },
            }));
          }
          if (data.transcript_path && /^session-\d+$/.test(matchedSession.name)) {
            import("./api").then(({ claude }) =>
              claude.generateSessionTitle(data.transcript_path!)
                .then((title) => { if (title) useStore.getState().renameSession(matchedSid!, title); })
                .catch(() => {})
            );
          }
        }
      } catch (err) { import("../lib/logger").then(({ logger }) => logger.warn("store", `session-state parse error: ${err}`)); }
    });
  } catch {
    // Not in Tauri — skip
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
  projectSessions: Record<string, string>; // pid -> derniere session active (non persiste)
  sessionCosts: Record<string, number>;
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
  updateSessionCost: (sid: string, cost: number) => void;
  setClaudeSessionId: (sid: string, claudeId: string) => void;
  setDangerousMode: (sid: string, on: boolean) => void;

  setSidebarWidth: (w: number) => void;
  setFontSize: (s: number) => void;
  setDefaultMode: (mode: import("./types").SessionMode) => void;
  setStatuslineAsked: () => void;
  updateSettings: (partial: Partial<Settings>) => void;

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
    autoNotifications: true,
  },
  loaded: false,
  sessionStates: {},
  sessionTools: {},
  projectSessions: {},
  sessionCosts: {},
  init: async () => {
    const data = await loadData();
    if (data && data.projects.length > 0) {
      set({
        projects: data.projects,
        activePid: data.activePid,
        activeSid: data.activeSid,
        settings: { ...get().settings, ...data.settings },
        loaded: true,
      });
    } else {
      // No data — show onboarding (create first project)
      set({ loaded: true });
    }
    // Setup watcher-based event listeners
    await setupSessionStateListener();
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
      // Auto-enable session hooks if setting is on
      if (s.settings.autoNotifications) {
        import("./api").then(({ claude }) => claude.enableSessionHooks(dir).catch(() => {}));
      }
      return next;
    });
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
  },

  addSession: (name, type) =>
    set((s) => {
      const proj = s.projects.find((p) => p.id === s.activePid);
      if (!proj) return s;
      const count = proj.sessions.length + 1;
      const defaultName = type === "terminal" ? `terminal-${count}` : `session-${count}`;
      const session = makeSession(name || defaultName, type);
      freshSessionIds.add(session.id);
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
    const current = get();
    const currentProj = current.projects.find((p) => p.id === current.activePid);
    if (!currentProj) return;
    // Guard: ignore if session already removed
    if (!currentProj.sessions.some((s) => s.id === sid)) return;
    // Kill PTY BEFORE state update to prevent race with new spawn
    pty.killSilent(sid);
    clearScrollback(sid);
    set((s) => {
      const proj = s.projects.find((p) => p.id === s.activePid);
      if (!proj) return s;
      const remaining = proj.sessions.filter((ss) => ss.id !== sid);
      const isLast = remaining.length === 0;
      const freshSession = isLast ? makeSession("main") : null;
      const sessions = isLast && freshSession ? [freshSession] : remaining;
      let activeSid: string;
      if (isLast && freshSession) {
        activeSid = freshSession.id;
      } else if (s.activeSid === sid) {
        const idx = proj.sessions.findIndex((ss) => ss.id === sid);
        const neighbor = Math.min(Math.max(idx - 1, 0), sessions.length - 1);
        activeSid = sessions[neighbor].id;
      } else {
        activeSid = s.activeSid;
      }
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

  setFontSize: (size) =>
    set((s) => {
      const clamped = Math.max(8, Math.min(20, size));
      const settings = { ...s.settings, fontSize: clamped };
      persist({ ...s, settings });
      return { settings };
    }),

  setDefaultMode: (mode) =>
    set((s) => {
      const settings = { ...s.settings, defaultMode: mode };
      persist({ ...s, settings });
      return { settings };
    }),

  setStatuslineAsked: () =>
    set((s) => {
      const settings = { ...s.settings, statuslineAsked: true };
      persist({ ...s, settings });
      return { settings };
    }),

  updateSettings: (partial) =>
    set((s) => {
      const settings = { ...s.settings, ...partial };
      persist({ ...s, settings });
      return { settings };
    }),

}));

// --- Selectors (reusable across components) ---

/** Select the active project — stable ref (only changes when activePid or the project itself changes) */
let _prevActiveProject: Project | undefined;
export const selectActiveProject = (s: AppStore) => {
  const proj = s.projects.find((p) => p.id === s.activePid);
  if (!proj) { _prevActiveProject = undefined; return undefined; }
  if (_prevActiveProject && _prevActiveProject.id === proj.id && _prevActiveProject === proj) return _prevActiveProject;
  _prevActiveProject = proj;
  return proj;
};

/** Select the active session */
export const selectActiveSession = (s: AppStore) => {
  const proj = s.projects.find((p) => p.id === s.activePid);
  return proj?.sessions.find((ss) => ss.id === s.activeSid);
};
