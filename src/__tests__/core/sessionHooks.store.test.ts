import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../core/persistence", () => ({ loadData: vi.fn().mockResolvedValue(null), debouncedSave: vi.fn() }));
vi.mock("../../core/api", () => ({ pty: { killSilent: vi.fn() }, scrollback: { clear: vi.fn() }, terminal: { notifyDone: vi.fn() }, listen: vi.fn() }));
import { useStore } from "../../core/store";
import { terminal } from "../../core/api";
import type { ObservationTarget } from "../../core/claudeObservation";
const targets = () => useStore.getState().captureObservationTargets();
const apply = (status: unknown, captured = targets(), extra = {}) => useStore.getState().applyClaudeSnapshot({ available: true, sessions: [{ sessionId: "c", kind: "interactive", status, ...extra }] }, captured);
beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks();
  useStore.setState({ projects: [{ id: "p", name: "Project", dir: "/p", sessions: [{ id: "s", name: "main", claudeSessionId: "c", runtimeStatus: "running" }] }], activePid: "p", activeSid: "other", sessionStates: {}, sessionTools: {}, sessionSubagents: {}, sessionPendingCompletions: {}, sessionRuntimeStartedAt: {}, settings: { ...useStore.getState().settings, autoNotifications: true } });
});
describe("official snapshot lifecycle (replaces installed hooks)", () => {
  it.each(["bogus", null, 42])("rejects invalid native status %s without completing a turn", (status) => {
    apply("busy"); apply(status);
    expect(useStore.getState().sessionStates.c).toBeUndefined();
    expect(terminal.notifyDone).not.toHaveBeenCalled();
  });
  it("does not bind foreign, prefix, or PID-only observations", () => {
    for (const sessionId of ["foreign", "c-prefix", undefined]) apply("busy", targets(), { sessionId, pid: 12 });
    expect(useStore.getState().sessionStates.c).toBeUndefined();
  });
  it("notifies and emits once per observed background turn, not duplicate snapshots", () => {
    const completed = vi.fn(); window.addEventListener("session-completed", completed);
    try {
      apply("idle"); expect(completed).not.toHaveBeenCalled();
      apply("busy"); apply("idle"); apply("idle");
      expect(terminal.notifyDone).toHaveBeenCalledExactlyOnceWith("Project — main");
      expect(completed).toHaveBeenCalledTimes(1);
      expect(useStore.getState().projects[0].sessions[0].unread).toBe(true);
      apply("waiting"); apply("idle");
      expect(completed).toHaveBeenCalledTimes(2);
    } finally { window.removeEventListener("session-completed", completed); }
  });
  it("records unread completion with notifications disabled", () => {
    useStore.getState().updateSettings({ autoNotifications: false });
    apply("busy"); apply("idle");
    expect(useStore.getState().projects[0].sessions[0].unread).toBe(true);
    expect(terminal.notifyDone).not.toHaveBeenCalled();
  });
  it("keeps the activated session read when an observed turn ends", () => {
    apply("busy"); useStore.getState().setActiveSession("s"); apply("idle");
    expect(useStore.getState().projects[0].sessions[0].unread).toBe(false);
    expect(terminal.notifyDone).not.toHaveBeenCalled();
  });
  it.each(["exited", "failed"] as const)("cannot resurrect %s or publish late completion", (status) => {
    apply("busy"); const captured = targets();
    useStore.getState().setSessionRuntimeStatus("s", status); apply("idle", captured);
    expect(useStore.getState().sessionStates.c).toBeUndefined();
    expect(terminal.notifyDone).not.toHaveBeenCalled();
  });
  it.each(["restart", "conversation", "archive", "remove", "remove-project", "init", "terminal"])("fences a request captured before %s", async (action) => {
    apply("busy"); const captured: ObservationTarget[] = targets(); const store = useStore.getState();
    if (action === "restart") store.setSessionRuntimeStatus("s", "running");
    if (action === "conversation") store.setClaudeSessionId("s", "new-c");
    if (action === "archive") { apply("idle"); store.archiveSession("s", true); }
    if (action === "remove") store.removeSession("s");
    if (action === "remove-project") { useStore.setState({ projects: [...store.projects, { id: "other", name: "Other", dir: "/other", sessions: [] }] }); store.removeProject("p"); }
    if (action === "init") await store.init();
    if (action === "terminal") useStore.setState({ projects: [{ ...store.projects[0], sessions: [{ ...store.projects[0].sessions[0], type: "terminal" }] }] });
    vi.mocked(terminal.notifyDone).mockClear();
    const before = useStore.getState().sessionStates;
    apply("idle", captured);
    expect(useStore.getState().sessionStates).toEqual(before);
    expect(terminal.notifyDone).not.toHaveBeenCalled();
  });
  it("accepts a fresh observation after exit and restart, not its stale predecessor", () => {
    apply("busy"); const captured = targets();
    useStore.getState().setSessionRuntimeStatus("s", "exited");
    useStore.getState().setSessionRuntimeStatus("s", "running");
    apply("idle", captured); expect(useStore.getState().sessionStates.c).toBeUndefined();
    apply("busy"); expect(useStore.getState().sessionStates.c).toBe("working");
  });
});
