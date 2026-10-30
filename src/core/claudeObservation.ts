export interface ObservationTarget {
  id: string;
  claudeSessionId: string;
  startedAt: number;
}

export interface ObservationLane { flight?: Promise<unknown> }

/** One native request at a time. Native command supplies the bounded timeout.
 * A shared lane survives HMR; stale owners may finish, but cannot publish.
 */
export function createObservationPoller<T>(options: {
  request: () => Promise<unknown>;
  targets: () => T[];
  apply: (snapshot: unknown, targets: T[]) => void;
  interval?: number;
  lane?: ObservationLane;
}) {
  const lane = options.lane ?? {};
  let stopCurrent: (() => void) | undefined;
  let retryCurrent: (() => void) | undefined;
  return {
    stop: () => stopCurrent?.(),
    retry: () => retryCurrent?.(),
    start() {
      stopCurrent?.();
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let ticking = false;
      let retryRequested = false;
      const stop = () => { cancelled = true; clearTimeout(timer); };
      stopCurrent = stop;
      const tick = async () => {
        if (ticking) { retryRequested = true; return; }
        ticking = true;
        if (lane.flight) await lane.flight;
        if (cancelled) return;
        const targets = options.targets();
        if (targets.length) {
          const flight = Promise.resolve().then(options.request).catch(() => ({ available: false, sessions: [], error: "unavailable" }));
          lane.flight = flight;
          const snapshot = await flight;
          if (lane.flight === flight) lane.flight = undefined;
          if (cancelled) return;
          options.apply(snapshot, targets);
        }
        ticking = false;
        if (!cancelled) timer = setTimeout(() => void tick(), retryRequested ? 0 : options.interval ?? 1500);
        retryRequested = false;
      };
      retryCurrent = () => {
        if (cancelled) return;
        clearTimeout(timer);
        void tick();
      };
      void tick();
      return stop;
    },
  };
}

export interface ClaudeSessionObservation {
  sessionId?: string;
  pid?: number;
  kind: "interactive" | "background";
  status?: "busy" | "waiting" | "idle";
  state?: "working" | "blocked" | "done" | "failed" | "stopped";
  waitingFor?: string;
}
export interface ClaudeSessionsSnapshot {
  available: boolean;
  sessions: ClaudeSessionObservation[];
  error?: "unavailable" | "invalid_output" | "timeout";
}
export type ObservationState = "working" | "waiting" | "idle";

/** No path, name or PID inference: the persisted full conversation ID is the binding. */
export function observationState(snapshot: unknown, sessionId: string): ObservationState | undefined {
  const value = snapshot as ClaudeSessionsSnapshot | null;
  if (!value || value.available !== true || value.error || !Array.isArray(value.sessions)) return;
  const matches = value.sessions.filter((entry) => entry && entry.sessionId === sessionId);
  if (matches.length !== 1) return;
  const entry = matches[0];
  if (!sessionId || (entry.pid !== undefined && (!Number.isSafeInteger(entry.pid) || entry.pid <= 0))
    || (entry.waitingFor !== undefined && typeof entry.waitingFor !== "string")
    || (entry.status !== undefined && !["busy", "waiting", "idle"].includes(entry.status))
    || (entry.state !== undefined && !["working", "blocked", "done", "failed", "stopped"].includes(entry.state))
    || entry.state === "failed" || entry.state === "stopped") return;
  if (entry.kind === "background") {
    if (entry.state === "working") return "working";
    if (entry.state === "blocked") return "waiting";
    if (entry.state === "done") return "idle";
    return;
  }
  if (entry.kind !== "interactive") return;
  return entry.status === "busy" ? "working" : entry.status === "waiting" ? "waiting" : entry.status === "idle" ? "idle" : undefined;
}
