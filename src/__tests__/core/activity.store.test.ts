import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../core/persistence", () => ({ loadData: vi.fn(), debouncedSave: vi.fn() }));
vi.mock("../../core/api", () => ({ pty: { killSilent: vi.fn() }, scrollback: { clear: vi.fn() }, listen: vi.fn().mockResolvedValue(() => {}) }));
import { useStore } from "../../core/store";
import { debouncedSave, loadData } from "../../core/persistence";
import { pty, scrollback } from "../../core/api";

const projects = () => [
  { id: "a", name: "Alpha", dir: "/a", sessions: [{ id: "a1", name: "main" }, { id: "a2", name: "result", claudeSessionId: "c2" }] },
  { id: "b", name: "Beta", dir: "/b", sessions: [{ id: "b1", name: "main" }] },
];
beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ projects: projects(), activePid: "b", activeSid: "b1", projectSessions: {}, sessionStates: {}, sessionCosts: {} });
});
describe("activity and resume", () => {
  it("records resume failures and process exits without leaving a dead session working", () => {
    useStore.getState().setSessionState("c2", "working");
    useStore.getState().setSessionRuntimeStatus("a2", "failed", "resume");
    expect(useStore.getState().projects[0].sessions[1]).toMatchObject({ runtimeStatus: "failed", failureReason: "resume", lastActivityAt: expect.any(Number) });
    expect(useStore.getState().sessionStates.c2).toBeUndefined();
    useStore.getState().setSessionRuntimeStatus("a2", "running");
    expect(useStore.getState().projects[0].sessions[1].failureReason).toBeUndefined();
    useStore.getState().setSessionRuntimeStatus("a2", "exited");
    expect(useStore.getState().projects[0].sessions[1].runtimeStatus).toBe("exited");
  });
  it("persists activity and unread completion across projects, then marks results read on opening", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(100).mockReturnValueOnce(200);
    useStore.getState().setSessionState("c2", "working");
    useStore.getState().setSessionState("c2", "idle");
    const completed = useStore.getState().projects[0].sessions[1];
    expect(completed).toMatchObject({ lastActivityAt: 200, unread: true });
    expect(vi.mocked(debouncedSave).mock.lastCall?.[0].projects[0].sessions[1]).toMatchObject({ lastActivityAt: 200, unread: true });
    vi.restoreAllMocks();
    useStore.getState().setActiveSession("a2");
    expect(useStore.getState().projects[0].sessions[1].unread).toBe(false);
  });
  it.each(["working", "waiting"] as const)("refuses to archive %s tasks even after confirmation", (state) => {
    useStore.getState().setSessionState("c2", state);
    expect(useStore.getState().archiveSession("a2", true)).toBe(false);
    expect(useStore.getState().projects[0].sessions[1].archivedAt).toBeUndefined();
  });
  it("requires an explicit stop confirmation, including for ordinary shell sessions", () => {
    expect(useStore.getState().archiveSession("a2")).toBe(false);
    useStore.getState().addSession("shell", "terminal");
    expect(useStore.getState().archiveSession(useStore.getState().activeSid)).toBe(false);
  });
  it("keeps a visible session when deleting the final unarchived session", () => {
    useStore.getState().archiveSession("a2", true);
    useStore.getState().setActiveSession("a1");
    useStore.getState().removeSession("a1");
    const current = useStore.getState();
    expect(current.projects[0].sessions.find((ss) => ss.id === current.activeSid)?.archivedAt).toBeUndefined();
    expect(current.activeSid).not.toBe("a2");
    expect(current.projects[0].sessions.find((ss) => ss.id === "a2")?.claudeSessionId).toBe("c2");
  });
  it("archives reversibly without deleting conversation or scrollback, and skips archives when opening projects", () => {
    useStore.getState().setActiveSession("a2");
    expect(useStore.getState().archiveSession("a2", true)).toBe(true);
    const archived = useStore.getState().projects[0].sessions.find((s) => s.id === "a2");
    expect(archived).toMatchObject({ id: "a2", claudeSessionId: "c2", archivedAt: expect.any(Number) });
    expect(useStore.getState().activeSid).toBe("a1");
    useStore.getState().setActiveSession("a2");
    expect(useStore.getState().activeSid).toBe("a1");
    useStore.getState().setActiveProject("b");
    useStore.getState().setActiveProject("a");
    expect(useStore.getState().activeSid).toBe("a1");
    useStore.getState().restoreSession("a2");
    useStore.getState().setActiveSession("a2");
    expect(useStore.getState().activeSid).toBe("a2");
    expect(useStore.getState().projects[0].sessions[1].archivedAt).toBeUndefined();
    expect(pty.killSilent).toHaveBeenCalledExactlyOnceWith("a2");
    expect(scrollback.clear).not.toHaveBeenCalled();
  });
  it("stops a background PTY before archiving and ignores repeated or unknown archive requests", () => {
    vi.mocked(pty.killSilent).mockImplementationOnce((sid) => {
      expect(useStore.getState().projects[0].sessions.find((ss) => ss.id === sid)?.archivedAt).toBeUndefined();
    });
    expect(useStore.getState().archiveSession("missing", true)).toBe(false);
    expect(useStore.getState().archiveSession("a2")).toBe(false);
    expect(pty.killSilent).not.toHaveBeenCalled();
    expect(useStore.getState().archiveSession("a2", true)).toBe(true);
    expect(useStore.getState().activeSid).toBe("b1");
    expect(useStore.getState().archiveSession("a2", true)).toBe(false);
    expect(pty.killSilent).toHaveBeenCalledExactlyOnceWith("a2");
    expect(scrollback.clear).not.toHaveBeenCalled();
  });
  it("restores remembered sessions after reload, preserving legacy defaults", async () => {
    vi.mocked(loadData).mockResolvedValue({ projects: projects(), activePid: "b", activeSid: "b1", settings: useStore.getState().settings, projectSessions: { a: "a2" } });
    await useStore.getState().init();
    useStore.getState().setActiveProject("a");
    expect(useStore.getState().activeSid).toBe("a2");
    vi.mocked(loadData).mockResolvedValue({ projects: projects(), activePid: "a", activeSid: "a2", settings: useStore.getState().settings });
    await useStore.getState().init();
    expect(useStore.getState().projectSessions.a).toBe("a2");
    useStore.getState().setActiveProject("b");
    expect(useStore.getState().activeSid).toBe("b1");
  });
  it("opens a session in its own project and persists that project's last session", () => {
    useStore.getState().setActiveSession("a2");
    expect(useStore.getState().activePid).toBe("a");
    expect(useStore.getState().projectSessions.a).toBe("a2");
    expect(vi.mocked(debouncedSave).mock.lastCall?.[0]).toMatchObject({ activePid: "a", activeSid: "a2", projectSessions: { a: "a2" } });
  });
});
