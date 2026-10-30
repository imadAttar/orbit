import { describe, expect, it } from "vitest";
import { buildActivity } from "../../core/activity";
import type { Project } from "../../core/types";

describe("cross-project activity", () => {
  it("ignores obsolete child data and shares authoritative native parent/process priorities", () => {
    const projects: Project[] = [{ id: "p", name: "P", dir: "/p", sessions: [
      { id: "fail", name: "Failed", runtimeStatus: "failed", claudeSessionId: "f" },
      { id: "parent", name: "Parent", runtimeStatus: "running", claudeSessionId: "c" },
    ] }];
    const rows = buildActivity(projects, { f: "working", c: "idle" }, false, { c: [{ id: "a", label: "Explore", status: "running", updatedAt: 1 }] });
    expect(rows.map((r) => [r.session.id, r.category])).toEqual([["fail", "failed"], ["parent", "recent"]]);
  });
  it("sorts archives by archive time rather than stale activity, without mutating project sessions", () => {
    const projects: Project[] = [{ id: "a", name: "A", dir: "/a", sessions: [
      { id: "older", name: "Older", archivedAt: 0, lastActivityAt: 100, claudeSessionId: "busy", unread: true },
      { id: "newer", name: "Newer", archivedAt: 50, lastActivityAt: 1, runtimeStatus: "failed" },
    ] }];
    const before = JSON.stringify(projects);
    expect(buildActivity(projects, { busy: "working" }, true).map((r) => [r.session.id, r.category])).toEqual([["newer", "archived"], ["older", "archived"]]);
    expect(buildActivity(projects, { busy: "working" })).toEqual([]);
    expect(buildActivity([], {})).toEqual([]);
    expect(JSON.stringify(projects)).toBe(before);
  });
  it("groups every project by actionable status, excludes archives by default and orders recent activity", () => {
    const projects: Project[] = [{ id: "a", name: "Alpha", dir: "/a", sessions: [
      { id: "old", name: "Legacy" },
      { id: "running", name: "Work", claudeSessionId: "c1", unread: true },
      { id: "waiting", name: "Question", claudeSessionId: "c2" },
      { id: "unread", name: "Result", unread: true },
      { id: "archived", name: "Archive", archivedAt: 10 },
    ] }, { id: "b", name: "Beta", dir: "/b", sessions: [
      { id: "failed", name: "Failure", runtimeStatus: "failed", failureReason: "resume" },
      { id: "recent", name: "Latest", lastActivityAt: 20 },
    ] }];
    const rows = buildActivity(projects, { c1: "working", c2: "waiting" });
    expect(rows.map((r) => [r.session.id, r.category])).toEqual([
      ["running", "working"], ["waiting", "waiting"], ["unread", "unread"], ["failed", "failed"], ["recent", "recent"], ["old", "recent"],
    ]);
    expect(rows.find((r) => r.session.id === "failed")?.project.id).toBe("b");
    expect(buildActivity(projects, {}, true).map((r) => r.session.id)).toEqual(["archived"]);
  });
});
