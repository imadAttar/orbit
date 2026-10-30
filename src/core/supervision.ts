import type { Project, Session, ClaudeSubagent } from "./types";
import type { SessionStates } from "./activity";

export type SupervisionStatus = "waiting" | "failed" | "unread" | "working" | "running" | "idle" | "exited" | "unknown";
export interface SupervisionRow {
  project: Project;
  session: Session;
  status: SupervisionStatus;
  needsAttention: boolean;
  tool?: string;
}

export type SupervisionFilter = "all" | "attention" | "active";
const statusOrder: SupervisionStatus[] = ["waiting", "failed", "unread", "working", "running", "idle", "exited", "unknown"];

export function selectSupervision(rows: SupervisionRow[], filter: SupervisionFilter, query: string): SupervisionRow[] {
  const search = query.trim().toLocaleLowerCase();
  return rows.filter((row) => (filter === "all" || (filter === "attention" ? row.needsAttention : row.status === "working" || row.status === "running"))
    && (!search || `${row.project.name} ${row.session.name}`.toLocaleLowerCase().includes(search)))
    .sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status)
      || (b.session.lastActivityAt ?? 0) - (a.session.lastActivityAt ?? 0));
}

export function observeSession(session: Session, states: SessionStates, subagents: ClaudeSubagent[] = []): SupervisionStatus {
  const hook = session.type !== "terminal" && session.claudeSessionId ? states[session.claudeSessionId] : undefined;
  // Process termination is authoritative; old hooks cannot resurrect it.
  return session.runtimeStatus === "failed" ? "failed"
    : session.runtimeStatus === "exited" ? (session.unread ? "unread" : "exited")
    : hook === "waiting" || hook === "working" ? hook
    : session.type !== "terminal" && subagents.some((a) => a.status === "running") ? "working"
    : session.unread ? "unread"
    : hook === "idle" ? "idle"
    : session.runtimeStatus === "running" ? "running" : "unknown";
}

export function needsAttention(status: SupervisionStatus): boolean {
  return status === "waiting" || status === "failed" || status === "unread";
}

export function buildSupervision(projects: Project[], states: SessionStates, tools: Record<string, string>, subagents: Record<string, ClaudeSubagent[]> = {}): SupervisionRow[] {
  return projects.flatMap((project) => project.sessions
    .filter((session) => session.archivedAt === undefined)
    .map((session): SupervisionRow => {
      const status = observeSession(session, states, session.claudeSessionId ? subagents[session.claudeSessionId] : []);
      return {
        project, session, status,
        needsAttention: needsAttention(status),
        tool: (status === "working" || status === "waiting") && session.claudeSessionId
          ? tools[session.claudeSessionId] || undefined : undefined,
      };
    }));
}
