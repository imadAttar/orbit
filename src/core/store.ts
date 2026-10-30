import { createHotStore } from "./hotStore";
import type { Project, Session, Settings, ClaudeSubagent } from "./types";
import { defaultTerminal } from "../lib/platform";
import { detectSystemLanguage } from "../i18n/i18n";
import { loadData, debouncedSave } from "./persistence";
import { pty, scrollback, terminal as terminalApi } from "./api";
import { observeSession } from "./supervision";
import { createObservationPoller, observationState, type ObservationLane, type ObservationTarget } from "./claudeObservation";

const storeHot = import.meta.env.DEV && import.meta.env.MODE !== "test" ? import.meta.hot : undefined;

// Track freshly created session IDs — these skip scrollback check on first mount
export const freshSessionIds: Set<string> = storeHot?.data.freshSessionIds ?? new Set<string>();

// --- Session state detection (global listener) ---

interface SessionStateData {
  hook_event_name?: string;
  agent_id?: string;
  agent_type?: string | null;
  session_id: string;
  state: string;
  ts: number;
  tool?: string;
  transcript_path?: string;
}

/** A child stop releases an observed parent completion, never proves success. */
function announceSessionCompletion(sid: string, project: Project, session: Session, data: SessionStateData) {
  const store = useStore.getState();
  if (store.settings.autoNotifications && store.activeSid !== sid) {
    terminalApi.notifyDone(`${project.name} — ${session.name}`);
    window.dispatchEvent(new CustomEvent("session-completed", { detail: { sessionId: sid, projectId: project.id } }));
  }
  if (data.transcript_path && /^session-\d+$/.test(session.name)) {
    import("./api").then(({ claude }) => claude.generateSessionTitle(data.transcript_path!)
      .then((title) => { if (title) useStore.getState().renameSession(sid, title); }).catch(() => {}));
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
  startClaudeObservation: () => () => void;
  captureObservationTargets: () => ObservationTarget[];
  applyClaudeSnapshot: (snapshot: unknown, targets: ObservationTarget[]) => void;
  /** @deprecated Compatibility UI name: read-only native observation health, never hook setup. */
  hookSetup: Record<string, "pending" | "ready" | "failed">;
  /** @deprecated Compatibility UI name: retry native observation, never configure Claude. */
  enableProjectHooks: (pid: string) => Promise<void>;
  sessionSubagents: Record<string, ClaudeSubagent[]>;
  sessionPendingCompletions: Record<string, SessionStateData>;
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
  toggleSessionPinned: (sid: string) => void;
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
  updateSettings: (partial: Partial<Settings>) => void;

}

function persist(state: AppStore) {
  // An uninitialized store is not authoritative (notably during development HMR).
  // Never replace an existing workspace with that transient empty snapshot.
  if (!state.loaded) return;
  debouncedSave({
    projects: state.projects,
    activePid: state.activePid,
    activeSid: state.activeSid,
    settings: state.settings,
    projectSessions: state.projectSessions,
  });
}

function withoutKeys<T>(record: Record<string, T>, keys: string[]): Record<string, T> {
  const next = { ...record };
  for (const key of keys) delete next[key];
  return next;
}

/** Transient observations belong to a conversation, never its replacement. */
function clearConversationObservations(state: AppStore, claudeIds: string[]) {
  return {
    sessionSubagents: withoutKeys(state.sessionSubagents, claudeIds),
    sessionStates: withoutKeys(state.sessionStates, claudeIds),
    sessionTools: withoutKeys(state.sessionTools, claudeIds),
    sessionHookTimestamps: withoutKeys(state.sessionHookTimestamps, claudeIds),
    sessionPendingCompletions: withoutKeys(state.sessionPendingCompletions, claudeIds),
  };
}

function clearRemovedSessionObservations(state: AppStore, sessions: Session[]) {
  const ids = sessions.map((session) => session.id);
  const { sessionSubagents, sessionStates, sessionTools, sessionPendingCompletions } = clearConversationObservations(
    state, sessions.flatMap((session) => session.claudeSessionId ? [session.claudeSessionId] : []),
  );
  // Retain ordering fences on removal; only a successful new spawn resets them.
  return { sessionSubagents, sessionStates, sessionTools, sessionPendingCompletions, sessionCosts: withoutKeys(state.sessionCosts, ids) };
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

export const useStore = createHotStore<AppStore>((set, get) => ({
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
  hookSetup: {},
  sessionSubagents: {},
  sessionPendingCompletions: {},
  sessionStates: {},
  sessionTools: {},
  projectSessions: {},
  sessionHookTimestamps: {},
  sessionRuntimeStartedAt: {},
  sessionCosts: {},
  init: async () => {
    const fences = Object.fromEntries(get().projects.flatMap((p) => p.sessions.map((s) => [s.id, Math.max(Date.now(), (get().sessionRuntimeStartedAt[s.id] ?? 0) + 1)])));
    set({ sessionHookTimestamps: {}, sessionRuntimeStartedAt: fences, sessionStates: {}, sessionTools: {}, sessionSubagents: {}, sessionPendingCompletions: {}, hookSetup: {} });
    const data = await loadData();
    if (data) {
      const projects = data.projects.map((p) => {
        const sessions = p.sessions.map((ss, index) => {
          // Earlier input bookkeeping could persist SGR mouse reports as titles.
          // Repair only protocol-only signatures (including a truncated final
          // report), never a meaningful/manual name or conversation identity.
          const damaged = ss.type !== "terminal" && typeof ss.name === "string" && ss.name.length <= 4096
            && /^(?:<?\d+;\d+;\d+[Mm]){2,}(?:<?[\d;]*)?$/.test(ss.name);
          const session = damaged ? { ...ss, name: `session-${index + 1}` } : ss;
          return session.runtimeStatus === "running"
            ? { ...session, runtimeStatus: "exited" as const, failureReason: undefined } : session;
        });
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
    // Observation never modifies Claude configuration.
  },

  startClaudeObservation: (): (() => void) => observationPoller.start(),

  captureObservationTargets: () => get().projects.flatMap((p) => p.sessions
    .filter((s) => s.type !== "terminal" && s.archivedAt === undefined && s.runtimeStatus === "running" && !!s.claudeSessionId)
    .map((s) => ({ id: s.id, claudeSessionId: s.claudeSessionId!, startedAt: get().sessionRuntimeStartedAt[s.id] ?? 0 }))),

  applyClaudeSnapshot: (snapshot, targets) => {
    for (const target of targets) {
      const current = get();
      const live = current.captureObservationTargets().find((s) => s.id === target.id && s.claudeSessionId === target.claudeSessionId && s.startedAt === target.startedAt);
      if (!live) continue;
      const project = current.projects.find((p) => p.sessions.some((s) => s.id === target.id))!;
      const session = project.sessions.find((s) => s.id === target.id)!;
      const id = target.claudeSessionId;
      const previous = current.sessionStates[id];
      const state = observationState(snapshot, id);
      const source = snapshot as { available?: boolean; sessions?: unknown; error?: unknown } | null;
      set({
        sessionTools: withoutKeys(current.sessionTools, [id]),
        sessionSubagents: withoutKeys(current.sessionSubagents, [id]),
        sessionPendingCompletions: withoutKeys(current.sessionPendingCompletions, [id]),
        sessionHookTimestamps: withoutKeys(current.sessionHookTimestamps, [id]),
        hookSetup: { ...current.hookSetup, [project.id]: source?.available === true && Array.isArray(source.sessions) && !source.error ? "ready" : "failed" },
        ...(state === undefined ? { sessionStates: withoutKeys(current.sessionStates, [id]) } : {}),
      });
      if (state === undefined) continue;
      get().setSessionState(id, state);
      if (state === "idle" && (previous === "working" || previous === "waiting")) {
        announceSessionCompletion(target.id, project, session, { session_id: id, state, ts: Date.now() });
      }
    }
  },

  // Compatibility name for the existing UI: this retries native observation, not hooks.
  enableProjectHooks: async (pid) => {
    if (!get().projects.some((p) => p.id === pid)) return;
    observationPoller.retry();
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
      const selection = needSwitch ? projectSelection(projects, projectSessions, activePid)
        : { projects, activePid, activeSid: s.activeSid, projectSessions };
      const next = { ...selection, ...clearRemovedSessionObservations(s, removed.sessions) };
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

  toggleSessionPinned: (sid) => set((s) => {
    const project = s.projects.find((p) => p.sessions.some((ss) => ss.id === sid));
    const session = project?.sessions.find((ss) => ss.id === sid);
    if (!project || !session || session.archivedAt !== undefined) return s;
    const projects = s.projects.map((p) => p.id === project.id
      ? { ...p, sessions: p.sessions.map((ss) => ss.id === sid ? { ...ss, pinned: !ss.pinned } : ss) } : p);
    persist({ ...s, projects });
    return { projects };
  }),

  reorderSession: (sid, targetSid) =>
    set((s) => {
      const proj = s.projects.find((p) => p.sessions.some((ss) => ss.id === sid));
      if (!proj || sid === targetSid) return s;
      const sessions = [...proj.sessions];
      const fromIdx = sessions.findIndex((ss) => ss.id === sid);
      const toIdx = sessions.findIndex((ss) => ss.id === targetSid);
      if (fromIdx === -1 || toIdx === -1) return s;
      const [moved] = sessions.splice(fromIdx, 1);
      sessions.splice(toIdx, 0, moved);
      const projects = s.projects.map((p) =>
        p.id === proj.id ? { ...p, sessions } : p
      );
      persist({ ...s, projects });
      return { projects };
    }),

  removeSession: (sid) => {
    const current = get();
    const currentProj = current.projects.find((p) => p.sessions.some((ss) => ss.id === sid));
    // Check ownership before side effects; repeated or unknown removals are no-ops.
    if (!currentProj) return;
    // Kill PTY BEFORE state update to prevent race with new spawn
    pty.killSilent(sid);
    clearScrollback(sid);
    set((s) => {
      const proj = s.projects.find((p) => p.id === currentProj.id);
      if (!proj || !proj.sessions.some((ss) => ss.id === sid)) return s;
      const remaining = proj.sessions.filter((ss) => ss.id !== sid);
      const visible = remaining.filter((ss) => ss.archivedAt === undefined);
      const freshSession = visible.length === 0 ? makeSession("main") : null;
      const sessions = freshSession ? [...remaining, freshSession] : remaining;
      const isActiveProject = s.activePid === proj.id;
      const preferredSid = isActiveProject ? s.activeSid : s.projectSessions[proj.id];
      const idx = proj.sessions.filter((ss) => ss.archivedAt === undefined).findIndex((ss) => ss.id === sid);
      const neighbor = Math.min(Math.max(idx - 1, 0), visible.length - 1);
      const selectedSid = sessions.find((ss) => ss.id === preferredSid && ss.archivedAt === undefined)?.id
        ?? freshSession?.id ?? visible[neighbor].id;
      const activeSid = isActiveProject ? selectedSid : s.activeSid;
      const projects = s.projects.map((p) =>
        p.id === proj.id ? { ...p, sessions: sessions.map((ss) => isActiveProject && ss.id === selectedSid ? { ...ss, unread: false } : ss) } : p
      );
      const next = {
        projects, activeSid, projectSessions: { ...s.projectSessions, [proj.id]: selectedSid },
        ...clearRemovedSessionObservations(s, proj.sessions.filter((ss) => ss.id === sid)),
      };
      persist({ ...s, ...next });
      return next;
    });
  },

  archiveSession: (sid, confirmedStop = false) => {
    const current = get();
    const project = current.projects.find((p) => p.sessions.some((ss) => ss.id === sid));
    const session = project?.sessions.find((ss) => ss.id === sid);
    if (!project || !session || session.archivedAt !== undefined || !confirmedStop) return false;
    const state = observeSession(session, current.sessionStates, session.claudeSessionId ? current.sessionSubagents[session.claudeSessionId] : []);
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
        sessionPendingCompletions: withoutKeys(s.sessionPendingCompletions, session.claudeSessionId ? [session.claudeSessionId] : []),
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
          ? { ...ss, lastActivityAt: now, unread: state === "idle" && (previous === "working" || previous === "waiting") && !(s.sessionSubagents[claudeSessionId] ?? []).some((a) => a.status === "running") ? ss.id !== s.activeSid : ss.unread }
          : ss
      ) }));
      const next = { projects, sessionStates: { ...s.sessionStates, [claudeSessionId]: state },
        ...(state !== "idle" ? { sessionPendingCompletions: withoutKeys(s.sessionPendingCompletions, [claudeSessionId]) } : {}),
      };
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
      ? { ...s.sessionRuntimeStartedAt, [sid]: Math.max(Date.now(), (s.sessionRuntimeStartedAt[sid] ?? 0) + 1) } : s.sessionRuntimeStartedAt;
    const sessionSubagents = { ...s.sessionSubagents };
    if (session.claudeSessionId) {
      if (status === "running") delete sessionSubagents[session.claudeSessionId];
      else if (sessionSubagents[session.claudeSessionId]) sessionSubagents[session.claudeSessionId] = sessionSubagents[session.claudeSessionId].map((agent) =>
        agent.status === "running" ? { ...agent, status: "unknown" as const } : agent);
    }
    const next = {
      projects, sessionStates, sessionRuntimeStartedAt, sessionSubagents,
      sessionPendingCompletions: withoutKeys(s.sessionPendingCompletions, session.claudeSessionId ? [session.claudeSessionId] : []),
      ...(status === "running" && session.claudeSessionId
        ? clearConversationObservations(s, [session.claudeSessionId]) : {}),
    };
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
      const session = s.projects.flatMap((p) => p.sessions).find((ss) => ss.id === sid);
      if (!session || session.claudeSessionId === claudeId) return s;
      const projects = s.projects.map((p) => ({
        ...p,
        sessions: p.sessions.map((ss) =>
          ss.id === sid ? { ...ss, claudeSessionId: claudeId } : ss
        ),
      }));
      const next = {
        projects,
        ...clearConversationObservations(s, session.claudeSessionId ? [session.claudeSessionId, claudeId] : [claudeId]),
      };
      persist({ ...s, ...next });
      return next;
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

  updateSettings: (partial) =>
    set((s) => {
      const settings = { ...s.settings, ...partial };
      persist({ ...s, settings });
      return { settings };
    }),

}), storeHot, data => {
  data.freshSessionIds = freshSessionIds;
  data.observationLane = observationLane;
  observationPoller.stop();

});


// Make the store itself the HMR boundary so Vite runs its disposal callback.
// Components keep the same Zustand API and refresh through normal subscriptions.
if (import.meta.hot && import.meta.env.MODE !== "test") import.meta.hot.accept();

const observationLane: ObservationLane = storeHot?.data.observationLane ?? {};
const observationPoller = createObservationPoller({
  lane: observationLane,
  request: async () => (await import("./api")).claude.sessionsSnapshot(),
  targets: () => useStore.getState().captureObservationTargets(),
  apply: (snapshot, targets) => useStore.getState().applyClaudeSnapshot(snapshot, targets),
});
if (storeHot && useStore.getState().loaded) observationPoller.start();

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
