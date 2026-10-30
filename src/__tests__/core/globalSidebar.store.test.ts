import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../core/persistence", () => ({ loadData: vi.fn(), debouncedSave: vi.fn() }));
vi.mock("../../core/api", () => ({ pty: { killSilent: vi.fn() }, scrollback: { clear: vi.fn() }, listen: vi.fn() }));
import { useStore } from "../../core/store";
import { pty, scrollback } from "../../core/api";
import { debouncedSave, loadData } from "../../core/persistence";

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ ...useStore.getInitialState(), loaded: true, projects: [
    { id: "a", name: "A", dir: "/a", sessions: [
      { id: "a1", name: "main", unread: true, hasConversation: true, claudeSessionId: "claude-a1", lastActivityAt: 42, runtimeStatus: "running" },
      { id: "a2", name: "second", unread: true },
      { id: "archive", name: "old", archivedAt: 0 },
    ] },
    { id: "b", name: "B", dir: "/b", sessions: [{ id: "b1", name: "main" }] },
  ], activePid: "b", activeSid: "b1", projectSessions: { a: "a1", b: "b1" },
  sessionHookTimestamps: { "claude-a1": 40 }, sessionRuntimeStartedAt: { a1: 30 },
  }, true);
});

const saved = () => vi.mocked(debouncedSave).mock.lastCall![0];

describe("global sidebar reordering", () => {
  it("reorders within the background owner and persists without changing session metadata or selection", () => {
    const before = useStore.getState();
    useStore.getState().reorderSession("a2", "a1");
    expect(useStore.getState().projects[0].sessions).toEqual([
      before.projects[0].sessions[1], before.projects[0].sessions[0], before.projects[0].sessions[2],
    ]);
    expect(useStore.getState().projects[1]).toBe(before.projects[1]);
    expect(useStore.getState()).toMatchObject({ activePid: "b", activeSid: "b1", projectSessions: before.projectSessions,
      sessionHookTimestamps: before.sessionHookTimestamps, sessionRuntimeStartedAt: before.sessionRuntimeStartedAt });
    expect(saved().projects).toEqual(useStore.getState().projects);
    expect(pty.killSilent).not.toHaveBeenCalled();
    expect(scrollback.clear).not.toHaveBeenCalled();
  });
  it.each([["a1", "b1"], ["b1", "a1"], ["missing", "a1"], ["a1", "missing"], ["a1", "a1"]])(
    "rejects foreign, missing or identical targets (%s → %s) without migration or persistence", (sid, targetSid) => {
      const before = useStore.getState();
      useStore.getState().reorderSession(sid, targetSid);
      expect(useStore.getState()).toBe(before);
      expect(debouncedSave).not.toHaveBeenCalled();
    },
  );
});

describe("global sidebar removal", () => {
  it("removes from the owner, repairs its remembered session without acknowledging background results, and is idempotent", () => {
    const before = useStore.getState();
    const survivor = before.projects[0].sessions[1];
    useStore.getState().removeSession("a1");
    expect(useStore.getState().projects[0].sessions.map((ss) => ss.id)).toEqual(["a2", "archive"]);
    expect(useStore.getState().projects[0].sessions[0]).toEqual(survivor);
    expect(useStore.getState()).toMatchObject({ activePid: "b", activeSid: "b1", projectSessions: { a: "a2", b: "b1" },
      sessionHookTimestamps: before.sessionHookTimestamps, sessionRuntimeStartedAt: before.sessionRuntimeStartedAt });
    expect(useStore.getState().projects[1]).toBe(before.projects[1]);
    expect(saved()).toMatchObject({ activePid: "b", activeSid: "b1", projectSessions: { a: "a2" } });
    const after = useStore.getState();
    useStore.getState().removeSession("a1");
    useStore.getState().removeSession("missing");
    expect(useStore.getState()).toBe(after);
    expect(pty.killSilent).toHaveBeenCalledExactlyOnceWith("a1");
    expect(scrollback.clear).toHaveBeenCalledExactlyOnceWith("a1");
    expect(debouncedSave).toHaveBeenCalledTimes(1);
  });
  it("creates a background main after the last visible removal, preserving archives and the foreground", () => {
    useStore.getState().removeSession("a2");
    useStore.getState().removeSession("a1");
    const state = useStore.getState();
    const visible = state.projects[0].sessions.filter((ss) => ss.archivedAt === undefined);
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({ name: "main", hasConversation: false });
    expect(state.projects[0].sessions.find((ss) => ss.id === "archive")).toMatchObject({ archivedAt: 0 });
    expect(state).toMatchObject({ activePid: "b", activeSid: "b1", projectSessions: { a: visible[0].id, b: "b1" } });
    expect(saved().projects).toEqual(state.projects);
  });
  it.each(["missing", "archive"])("repairs stale remembered %s when removing an unselected background session", (remembered) => {
    useStore.setState({ projectSessions: { a: remembered, b: "b1" } });
    useStore.getState().removeSession("a2");
    expect(useStore.getState()).toMatchObject({ activePid: "b", activeSid: "b1", projectSessions: { a: "a1" } });
    expect(useStore.getState().projects[0].sessions[0].unread).toBe(true);
  });
  it("preserves valid background memory when deleting a different session or archive", () => {
    useStore.getState().removeSession("a2");
    useStore.getState().removeSession("archive");
    expect(useStore.getState()).toMatchObject({ activePid: "b", activeSid: "b1", projectSessions: { a: "a1" } });
    expect(useStore.getState().projects[0].sessions[0].unread).toBe(true);
  });
  it("replaces the foreground last visible session and repairs memory", () => {
    useStore.getState().removeSession("b1");
    const state = useStore.getState();
    expect(state.activePid).toBe("b");
    expect(state.activeSid).not.toBe("b1");
    expect(state.projects[1].sessions).toEqual([expect.objectContaining({ id: state.activeSid, name: "main", unread: false })]);
    expect(state.projectSessions.b).toBe(state.activeSid);
  });
});

describe("global sidebar pinning", () => {
  it("toggles a background session and persists it without altering activity or selection", async () => {
    const before = useStore.getState();
    const session = before.projects[0].sessions[0];
    useStore.getState().toggleSessionPinned("a1");
    expect(useStore.getState().projects[0].sessions[0]).toEqual({ ...session, pinned: true });
    expect(useStore.getState()).toMatchObject({ activePid: "b", activeSid: "b1", projectSessions: before.projectSessions,
      sessionHookTimestamps: before.sessionHookTimestamps, sessionRuntimeStartedAt: before.sessionRuntimeStartedAt });
    expect(saved().projects[0].sessions[0].pinned).toBe(true);
    vi.mocked(loadData).mockResolvedValue(saved());
    await useStore.getState().init();
    expect(useStore.getState().projects[0].sessions[0].pinned).toBe(true);
    useStore.getState().toggleSessionPinned("a1");
    expect(saved().projects[0].sessions[0].pinned).toBe(false);
    expect(pty.killSilent).not.toHaveBeenCalled();
    expect(scrollback.clear).not.toHaveBeenCalled();
  });
  it("ignores missing sessions and archives, including archivedAt zero", () => {
    const before = useStore.getState();
    useStore.getState().toggleSessionPinned("archive");
    useStore.getState().toggleSessionPinned("missing");
    expect(useStore.getState()).toBe(before);
    expect(debouncedSave).not.toHaveBeenCalled();
  });
});
