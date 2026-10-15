import type { Project, Session } from "./types";

export type ActivityCategory = "working" | "waiting" | "unread" | "failed" | "recent" | "archived";
export type SessionStates = Record<string, "working" | "idle" | "waiting">;
export const activityCategories: ActivityCategory[] = ["working", "waiting", "unread", "failed", "recent", "archived"];

export function buildActivity(projects: Project[], states: SessionStates, archives = false) {
  return projects.flatMap((project) => project.sessions
    .filter((session) => (session.archivedAt !== undefined) === archives)
    .map((session): { project: Project; session: Session; category: ActivityCategory } => {
      const state = session.claudeSessionId ? states[session.claudeSessionId] : undefined;
      const category: ActivityCategory = archives ? "archived"
        : state === "working" || state === "waiting" ? state
        : session.runtimeStatus === "failed" ? "failed"
        : session.unread ? "unread" : "recent";
      return { project, session, category };
    }))
    .sort((a, b) => activityCategories.indexOf(a.category) - activityCategories.indexOf(b.category)
      || (archives
        ? (b.session.archivedAt ?? 0) - (a.session.archivedAt ?? 0)
        : (b.session.lastActivityAt ?? 0) - (a.session.lastActivityAt ?? 0)));
}
