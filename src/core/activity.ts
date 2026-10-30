import type { Project, Session, ClaudeSubagent } from "./types";
import { observeSession } from "./supervision";

export type ActivityCategory = "working" | "waiting" | "unread" | "failed" | "recent" | "archived";
export type SessionStates = Record<string, "working" | "idle" | "waiting">;
export const activityCategories: ActivityCategory[] = ["working", "waiting", "unread", "failed", "recent", "archived"];

export function buildActivity(projects: Project[], states: SessionStates, archives = false, subagents: Record<string, ClaudeSubagent[]> = {}) {
  return projects.flatMap((project) => project.sessions
    .filter((session) => (session.archivedAt !== undefined) === archives)
    .map((session): { project: Project; session: Session; category: ActivityCategory } => {
      const state = observeSession(session, states, session.claudeSessionId ? subagents[session.claudeSessionId] : []);
      const category: ActivityCategory = archives ? "archived"
        : state === "working" || state === "waiting" ? state
        : state === "failed" || state === "unread" ? state : "recent";
      return { project, session, category };
    }))
    .sort((a, b) => activityCategories.indexOf(a.category) - activityCategories.indexOf(b.category)
      || (archives
        ? (b.session.archivedAt ?? 0) - (a.session.archivedAt ?? 0)
        : (b.session.lastActivityAt ?? 0) - (a.session.lastActivityAt ?? 0)));
}
