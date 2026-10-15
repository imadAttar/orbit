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

async function setupSessionStateListener() {
  try {
    await listen<string>("session-state-changed", (raw) => {
      try {
        const data = JSON.parse(raw) as SessionStateData;
        if (!data || typeof data.session_id !== "string" || !data.session_id
          || !["working", "idle", "waiting"].includes(data.state)
          || !Number.isSafeInteger(data.ts) || data.ts <= 0) return;

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

        if (matchedSession.archivedAt !== undefined || matchedSession.runtimeStatus === "exited" || matchedSession.runtimeStatus === "failed") return;
        if (data.ts <= (store.sessionHookTimestamps[data.session_id] ?? 0)
          || data.ts < (store.sessionRuntimeStartedAt[matchedSid] ?? 0)) return;
        useStore.setState({ sessionHookTimestamps: { ...store.sessionHookTimestamps, [data.session_id]: data.ts } });
        const prev = store.sessionStates[data.session_id];

        store.setSessionState(data.session_id, data.state as "working" | "idle" | "waiting");
        if (typeof data.tool === "string" && data.tool) store.setSessionTool(data.session_id, data.tool);
        if (data.state === "idle" && prev === "working") {
          if (store.settings.autoNotifications && store.activeSid !== matchedSid) {
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
  return { id: uid(), name, type: type ?? "claude", hasConversation: false };
}

/**
 * True when the session is known to have an active Claude conversation
 * (user sent at least one prompt after the last spawn).
 *
 * Strict: `undefined` (legacy sessions persisted before the `hasConversation`
 * flag was added) resolves to `false`. This avoids spawning `claude --resume`
 * on sessions whose Claude-side state may not exist, which would surface as
 * "No conversation found with session ID" in the terminal.
 *
 * Trade-off: a legacy session that truly had a conversation loses `--resume`
 * continuity on the first mode toggle. After the next prompt the flag is set
 * and subsequent toggles resume correctly.
 */
export function sessionHasConversation(session: Session | undefined): boolean {
  return session?.hasConversation === true;
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
  sessionHookTimestamps: Record<string, number>; // accepted hooks, including same-state updates
  sessionRuntimeStartedAt: Record<string, number>; // local session id -> latest spawn boundary
  projectSessions: Record<string, string>; // pid -> persisted last visible session
  sessionCosts: Record<string, number>;
  init: () => Promise<void>;

  addProject: (name: string, dir: string) => void;
  renameProject: (pid: string, name: string) => void;
  removeProject: (pid: string) => void;
  setActiveProject: (pid: string) => void;

  addSession: (name?: string, type?: import("./types").SessionType) => void;
  renameSession: (sid: string, name: string) => void;
  removeSession: (sid: string) => void;
  archiveSession: (sid: string, confirmedStop?: boolean) => boolean;
  restoreSession: (sid: string) => void;
  setActiveSession: (sid: string) => void;

  reorderSession: (sid: string, targetSid: string) => void;

  setSessionState: (claudeSessionId: string, state: "working" | "idle" | "waiting") => void;
  setSessionRuntimeStatus: (sid: string, status: NonNullable<Session["runtimeStatus"]>, reason?: Session["failureReason"]) => void;
  setSessionTool: (claudeSessionId: string, tool: string) => void;
  updateSessionCost: (sid: string, cost: number) => void;
  setClaudeSessionId: (sid: string, claudeId: string) => void;
  setDangerousMode: (sid: string, on: boolean) => void;
  markConversationStarted: (sid: string) => void;

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
    projectSessions: state.projectSessions,
  });
}

/** Select a usable session, repair stale memory and acknowledge its result. */
function projectSelection(projects: Project[], projectSessions: Record<string, string>, pid: string) {
  const project = projects.find((p) => p.id === pid)!;
  const sessions = project.sessions.some((ss) => ss.archivedAt === undefined)
    ? project.sessions : [...project.sessions, makeSession("main")];
  const activeSid = sessions.find((ss) => ss.id === projectSessions[pid] && ss.archivedAt === undefined)?.id
    ?? sessions.find((ss) => ss.archivedAt === undefined)!.id;
  return {
    projects: projects.map((p) => p.id === pid ? { ...p, sessions: sessions.map((ss) => ss.id === activeSid ? { ...ss, unread: false } : ss) } : p),
    activePid: pid,
    activeSid,
    projectSessions: { ...projectSessions, [pid]: activeSid },
  };
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
    analytics: false,
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
  sessionHookTimestamps: {},
  sessionRuntimeStartedAt: {},
  sessionCosts: {},
  init: async () => {
    set({ sessionHookTimestamps: {}, sessionRuntimeStartedAt: {} });
    const data = await loadData();
    if (data) {
      const projects = data.projects.map((p) => {
        const sessions = p.sessions.map((ss) => ss.runtimeStatus === "running"
          ? { ...ss, runtimeStatus: "exited" as const, failureReason: undefined } : ss);
        if (!sessions.some((ss) => ss.archivedAt === undefined)) sessions.push(makeSession("main"));
        return { ...p, sessions };
      });
      const activePid = projects.find((p) => p.id === data.activePid)?.id ?? projects[0]?.id ?? "";
      const projectSessions = Object.fromEntries(projects.map((p) => {
        const preferred = p.id === activePid ? data.activeSid : data.projectSessions?.[p.id];
        const sid = p.sessions.find((ss) => ss.id === preferred && ss.archivedAt === undefined)?.id
          ?? p.sessions.find((ss) => ss.id === data.projectSessions?.[p.id] && ss.archivedAt === undefined)?.id
          ?? p.sessions.find((ss) => ss.archivedAt === undefined)!.id;
        return [p.id, sid];
      }));
      set({
        projects,
        activePid,
        activeSid: projectSessions[activePid] ?? "",
        projectSessions,
        sessionStates: {},
        sessionTools: {},
        sessionCosts: {},
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
        projectSessions: { ...s.projectSessions, [p.id]: p.sessions[0].id },
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
    if (!removed || state.projects.length <= 1) return;
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
      const projectSessions = { ...s.projectSessions };
      delete projectSessions[pid];
      const next = needSwitch ? projectSelection(projects, projectSessions, activePid)
        : { projects, activePid, activeSid: s.activeSid, projectSessions };
      persist({ ...s, ...next });
      return next;
    });
  },

  setActiveProject: (pid) => {
    const proj = get().projects.find((p) => p.id === pid);
    if (!proj) return;
    set((s) => {
      const next = projectSelection(s.projects, s.projectSessions, pid);
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
      const next = { projects, activeSid: session.id, projectSessions: { ...s.projectSessions, [s.activePid]: session.id } };
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
      const visible = remaining.filter((ss) => ss.archivedAt === undefined);
      const isLast = visible.length === 0;
      const freshSession = isLast ? makeSession("main") : null;
      const sessions = freshSession ? [...remaining, freshSession] : remaining;
      let activeSid: string;
      if (isLast && freshSession) {
        activeSid = freshSession.id;
      } else if (s.activeSid === sid) {
        const idx = proj.sessions.filter((ss) => ss.archivedAt === undefined).findIndex((ss) => ss.id === sid);
        const neighbor = Math.min(Math.max(idx - 1, 0), visible.length - 1);
        activeSid = visible[neighbor].id;
      } else {
        activeSid = s.activeSid;
      }
      const projects = s.projects.map((p) =>
        p.id === s.activePid ? { ...p, sessions: sessions.map((ss) => ss.id === activeSid ? { ...ss, unread: false } : ss) } : p
      );
      const next = { projects, activeSid, projectSessions: { ...s.projectSessions, [s.activePid]: activeSid } };
      persist({ ...s, ...next });
      return next;
    });
  },

  archiveSession: (sid, confirmedStop = false) => {
    const current = get();
    const project = current.projects.find((p) => p.sessions.some((ss) => ss.id === sid));
    const session = project?.sessions.find((ss) => ss.id === sid);
    if (!project || !session || session.archivedAt !== undefined || !confirmedStop) return false;
    const state = session.claudeSessionId ? current.sessionStates[session.claudeSessionId] : undefined;
    if (state === "working" || state === "waiting") return false;
    // Stop even background PTYs; archiving must never delete scrollback.
    pty.killSilent(sid);
    set((s) => {
      let sessions = project.sessions.map((ss) => ss.id === sid ? { ...ss, archivedAt: Date.now() } : ss);
      // Keep a usable project even when its final visible session is archived.
      if (!sessions.some((ss) => ss.archivedAt === undefined)) sessions = [...sessions, makeSession("main")];
      const fallback = sessions.find((ss) => ss.archivedAt === undefined)!;
      const projects = s.projects.map((p) => p.id === project.id ? { ...p, sessions } : p);
      const next = {
        projects,
        activeSid: s.activeSid === sid ? fallback.id : s.activeSid,
        projectSessions: { ...s.projectSessions, [project.id]: s.projectSessions[project.id] === sid ? fallback.id : s.projectSessions[project.id] ?? fallback.id },
      };
      // PTY was explicitly stopped above; retain transcript and scrollback.
      persist({ ...s, ...next });
      return next;
    });
    return true;
  },

  restoreSession: (sid) => set((s) => {
    const projects = s.projects.map((p) => ({ ...p, sessions: p.sessions.map((ss) => ss.id === sid ? { ...ss, archivedAt: undefined } : ss) }));
    persist({ ...s, projects });
    return { projects };
  }),

  setActiveSession: (sid) =>
    set((s) => {
      const project = s.projects.find((p) => p.sessions.some((ss) => ss.id === sid));
      if (!project || project.sessions.find((ss) => ss.id === sid)?.archivedAt !== undefined) return s;
      const next = {
        projects: s.projects.map((p) => p.id === project.id ? { ...p, sessions: p.sessions.map((ss) => ss.id === sid ? { ...ss, unread: false } : ss) } : p),
        activePid: project.id,
        activeSid: sid,
        projectSessions: { ...s.projectSessions, [project.id]: sid },
      };
      persist({ ...s, ...next });
      return next;
    }),

  setSessionState: (claudeSessionId, state) =>
    set((s) => {
      const previous = s.sessionStates[claudeSessionId];
      if (previous === state) return s;
      const now = Date.now();
      const projects = s.projects.map((p) => ({ ...p, sessions: p.sessions.map((ss) =>
        ss.claudeSessionId === claudeSessionId && ss.archivedAt === undefined
          ? { ...ss, lastActivityAt: now, unread: state === "idle" && (previous === "working" || previous === "waiting") ? ss.id !== s.activeSid : ss.unread }
          : ss
      ) }));
      const next = { projects, sessionStates: { ...s.sessionStates, [claudeSessionId]: state } };
      persist({ ...s, ...next });
      return next;
    }),

  // Contract for the PTY owner: report successful spawn, process exit and spawn/resume failure.
  setSessionRuntimeStatus: (sid, status, reason) => set((s) => {
    const session = s.projects.flatMap((p) => p.sessions).find((ss) => ss.id === sid);
    if (!session || session.archivedAt !== undefined) return s;
    const projects = s.projects.map((p) => ({ ...p, sessions: p.sessions.map((ss) => ss.id === sid
      ? { ...ss, runtimeStatus: status, failureReason: status === "failed" ? reason : undefined, lastActivityAt: Date.now() } : ss) }));
    const sessionStates = { ...s.sessionStates };
    if (session.claudeSessionId && status !== "running") delete sessionStates[session.claudeSessionId];
    const sessionRuntimeStartedAt = status === "running"
      ? { ...s.sessionRuntimeStartedAt, [sid]: Date.now() } : s.sessionRuntimeStartedAt;
    const next = { projects, sessionStates, sessionRuntimeStartedAt };
    persist({ ...s, ...next });
    return next;
  }),

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

  markConversationStarted: (sid) =>
    set((s) => {
      // No-op if already marked — avoids re-persisting on every prompt
      const already = s.projects.some((p) =>
        p.sessions.some((ss) => ss.id === sid && ss.hasConversation === true)
      );
      if (already) return {};
      const projects = s.projects.map((p) => ({
        ...p,
        sessions: p.sessions.map((ss) =>
          ss.id === sid ? { ...ss, hasConversation: true } : ss
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
