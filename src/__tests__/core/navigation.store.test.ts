import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../core/persistence", () => ({ loadData: vi.fn(), debouncedSave: vi.fn() }));
vi.mock("../../core/api", () => ({ pty: { killSilent: vi.fn() }, scrollback: { clear: vi.fn() }, listen: vi.fn(), claude: { enableSessionHooks: vi.fn().mockResolvedValue(undefined) } }));
import { useStore } from "../../core/store";
import { pty, scrollback } from "../../core/api";
import { debouncedSave } from "../../core/persistence";
beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ ...useStore.getInitialState(), projects: [
    { id: "a", name: "A", dir: "/a", sessions: [{ id: "a1", name: "main", unread: true }, { id: "a2", name: "result", unread: true }, { id: "archived", name: "old", archivedAt: 0 }] },
    { id: "b", name: "B", dir: "/b", sessions: [{ id: "b1", name: "main" }] },
  ], activePid: "b", activeSid: "b1", projectSessions: { a: "a2", b: "b1" } }, true);
});
describe("project navigation invariants", () => {
  it("remembers newly created sessions immediately across project changes", () => {
    useStore.getState().addSession("new");
    const sid = useStore.getState().activeSid;
    expect(useStore.getState().projectSessions.b).toBe(sid);
    useStore.getState().setActiveProject("a");
    useStore.getState().setActiveProject("b");
    expect(useStore.getState().activeSid).toBe(sid);
  });
  it("acknowledges only the selected project's remembered result and persists it", () => {
    useStore.getState().setActiveProject("a");
    expect(useStore.getState().projects[0].sessions[1].unread).toBe(false);
    expect(useStore.getState().projects[0].sessions[0].unread).toBe(true);
    expect(vi.mocked(debouncedSave).mock.lastCall?.[0].projects[0].sessions[1].unread).toBe(false);
  });
  it("repairs stale remembered archives on project change", () => {
    useStore.setState({ projectSessions: { a: "archived", b: "b1" } });
    useStore.getState().setActiveProject("a");
    expect(useStore.getState()).toMatchObject({ activeSid: "a1", projectSessions: { a: "a1" } });
    expect(useStore.getState().projects[0].sessions[0].unread).toBe(false);
  });
  it("repairs the map and acknowledges the fallback after deleting an active session", () => {
    useStore.getState().setActiveProject("a");
    useStore.getState().removeSession("a2");
    expect(useStore.getState()).toMatchObject({ activeSid: "a1", projectSessions: { a: "a1" } });
    expect(useStore.getState().projects[0].sessions[0].unread).toBe(false);
  });
  it("cleans removed projects and restores the remembered visible result, not an archive", () => {
    useStore.getState().removeProject("b");
    expect(useStore.getState()).toMatchObject({ activePid: "a", activeSid: "a2", projectSessions: { a: "a2" } });
    expect(useStore.getState().projectSessions.b).toBeUndefined();
    expect(useStore.getState().projects[0].sessions[1].unread).toBe(false);
  });
  it("does not stop or erase the last project's PTYs when refusing removal", () => {
    useStore.setState({ projects: [useStore.getState().projects[1]] });
    useStore.getState().removeProject("b");
    expect(pty.killSilent).not.toHaveBeenCalled();
    expect(scrollback.clear).not.toHaveBeenCalled();
  });
  it("creates a usable session when switching to an all-archive or empty project", () => {
    useStore.setState({ projects: useStore.getState().projects.map((p) => p.id === "a" ? { ...p, sessions: p.sessions.filter((s) => s.archivedAt !== undefined) } : p) });
    useStore.getState().setActiveProject("a");
    const state = useStore.getState();
    expect(state.activePid).toBe("a");
    expect(state.projects[0].sessions.find((s) => s.id === state.activeSid)?.name).toBe("main");
    expect(state.projectSessions.a).toBe(state.activeSid);
  });
  it("remembers the first session of newly added projects", () => {
    useStore.getState().addProject("C", "/c");
    const state = useStore.getState();
    expect(state.projectSessions[state.activePid]).toBe(state.activeSid);
  });
});
