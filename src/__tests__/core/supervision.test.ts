import { describe, expect, it } from "vitest";
import { buildSupervision, selectSupervision } from "../../core/supervision";
import type { Project } from "../../core/types";

describe("supervision derived from observed session state", () => {
  it("does not present legacy child activity/tools as official observation and reports a missing live agent as unknown", () => {
    const projects: Project[] = [{ id: "p", name: "P", dir: "/p", sessions: [{ id: "s", name: "Parent", claudeSessionId: "c", runtimeStatus: "running", unread: true }] }];
    const children = { c: [{ id: "old", label: "Old", status: "running" as const, updatedAt: 1 }] };
    expect(buildSupervision(projects, {}, { c: "Old tool" }, children)[0]).toMatchObject({ status: "unknown", tool: undefined });
    expect(buildSupervision(projects, { c: "idle" }, {}, children)[0].status).toBe("unread");
  });
  it("ignores legacy live children after official idle and never resurrects an exited process", () => {
    const projects: Project[] = [{ id: "p", name: "P", dir: "/p", sessions: [
      { id: "s", name: "Parent", claudeSessionId: "c", runtimeStatus: "running", unread: true },
      { id: "x", name: "Exited", claudeSessionId: "e", runtimeStatus: "exited" },
    ] }];
    const subagents = { c: [{ id: "a", label: "Explore", status: "running" as const, updatedAt: 1 }], e: [{ id: "b", label: "Explore", status: "running" as const, updatedAt: 1 }] };
    const rows = buildSupervision(projects, { c: "idle" }, {}, subagents);
    expect(rows.map((r) => r.status)).toEqual(["unread", "exited"]);
  });
  it("filters across projects without mixing a live process with an idle agent", () => {
    const rows = buildSupervision([{ id: "p", name: "Onyx", dir: "/onyx", sessions: [
      { id: "work", name: "Navigation", claudeSessionId: "w", lastActivityAt: 1 },
      { id: "wait", name: "Question", claudeSessionId: "q", lastActivityAt: 2 },
      { id: "fail", name: "Reprise", runtimeStatus: "failed", lastActivityAt: 3 },
      { id: "idle", name: "Ready", claudeSessionId: "i", runtimeStatus: "running" },
      { id: "new", name: "Result", unread: true },
    ] }], { w: "working", q: "waiting", i: "idle" }, {});
    expect(selectSupervision(rows, "attention", "  ONYX ").map((r) => r.session.id)).toEqual(["wait", "fail", "new"]);
    expect(selectSupervision(rows, "active", "").map((r) => r.session.id)).toEqual(["work"]);
    expect(selectSupervision(rows, "all", "reprise").map((r) => r.session.id)).toEqual(["fail"]);
    expect(selectSupervision(rows, "all", "absent")).toEqual([]);
    expect(rows[0].session.id).toBe("work");
  });
  it("distinguishes CLI work, a waiting question and an open process without pretending it is working", () => {
    const projects: Project[] = [{ id: "p", name: "P", dir: "/p", sessions: [
      { id: "unknown", name: "Not observed" },
      { id: "shell", name: "Shell", type: "terminal", runtimeStatus: "running", claudeSessionId: "c" },
      { id: "work", name: "Work", claudeSessionId: "c", runtimeStatus: "running" },
      { id: "wait", name: "Question", claudeSessionId: "q", runtimeStatus: "running" },
      { id: "idle", name: "Ready", claudeSessionId: "i", runtimeStatus: "running" },
      { id: "gone", name: "Exited", claudeSessionId: "q", runtimeStatus: "exited" },
      { id: "result", name: "Result", unread: true, runtimeStatus: "exited" },
      { id: "archive", name: "Archive", archivedAt: 0 },
    ] }];
    const before = JSON.stringify(projects);
    const rows = buildSupervision(projects, { c: "working", q: "waiting", i: "idle" }, { c: "Read", q: "Bash", i: "Old" });
    const byId = Object.fromEntries(rows.map((r) => [r.session.id, r]));
    expect(rows).toHaveLength(7);
    expect(byId.work).toMatchObject({ status: "working", tool: undefined, needsAttention: false });
    expect(byId.wait).toMatchObject({ status: "waiting", tool: undefined, needsAttention: true });
    expect(byId.shell).toMatchObject({ status: "running", tool: undefined, needsAttention: false });
    expect(byId.idle).toMatchObject({ status: "idle", tool: undefined });
    expect(byId.gone).toMatchObject({ status: "exited", needsAttention: false, tool: undefined });
    expect(byId.result).toMatchObject({ status: "unread", needsAttention: true });
    expect(byId.unknown).toMatchObject({ status: "unknown", needsAttention: false });
    expect(JSON.stringify(projects)).toBe(before);
  });
  it("lets a failed process override an old working hook and hides its stale tool", () => {
    const projects: Project[] = [{ id: "p", name: "Orbit", dir: "/orbit", sessions: [
      { id: "s", name: "Review", claudeSessionId: "c", runtimeStatus: "failed", failureReason: "resume" },
    ] }];
    const rows = buildSupervision(projects, { c: "working" }, { c: "Bash" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "failed", needsAttention: true, tool: undefined });
  });
});
