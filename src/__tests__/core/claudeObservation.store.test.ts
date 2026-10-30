import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../core/persistence", () => ({ loadData: vi.fn(), debouncedSave: vi.fn() }));
vi.mock("../../core/api", () => ({ claude: { sessionsSnapshot: vi.fn(), removeSessionHooks: vi.fn().mockResolvedValue(false), enableSessionHooks: vi.fn() }, terminal: { notifyDone: vi.fn() }, pty: { killSilent: vi.fn() }, scrollback: { clear: vi.fn() }, listen: vi.fn() }));
import { useStore } from "../../core/store";
import { terminal, claude } from "../../core/api";
const snapshot = (entry: object) => ({ available: true, sessions: [{ sessionId: "exact", kind: "interactive", ...entry }] });
beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ loaded: true, activeSid: "other", projects: [{ id: "p", name: "P", dir: "/p", sessions: [{ id: "s", name: "Main", claudeSessionId: "exact", runtimeStatus: "running" }] }], sessionStates: {}, sessionTools: {}, sessionSubagents: {}, sessionPendingCompletions: {}, settings: { ...useStore.getState().settings, autoNotifications: true } });
});
it("fences same-millisecond process restarts and changed conversation identities", () => {
  vi.spyOn(Date, "now").mockReturnValue(1000);
  useStore.getState().setSessionRuntimeStatus("s", "running");
  const targets = useStore.getState().captureObservationTargets();
  useStore.getState().setSessionRuntimeStatus("s", "running");
  useStore.getState().applyClaudeSnapshot(snapshot({ status: "busy" }), targets);
  expect(useStore.getState().sessionStates.exact).toBeUndefined();
  vi.restoreAllMocks();
});

it("unknown clears stale state without an exit or completion; initial idle is not a completion", () => {
  const targets = useStore.getState().captureObservationTargets();
  useStore.getState().applyClaudeSnapshot(snapshot({ status: "idle" }), targets);
  expect(terminal.notifyDone).not.toHaveBeenCalled();
  useStore.getState().applyClaudeSnapshot(snapshot({ status: "busy" }), targets);
  useStore.getState().applyClaudeSnapshot({ available: false, sessions: [], error: "timeout" }, targets);
  expect(useStore.getState().sessionStates.exact).toBeUndefined();
  expect(useStore.getState().projects[0].sessions[0].runtimeStatus).toBe("running");
  expect(useStore.getState().hookSetup.p).toBe("failed");
  useStore.getState().applyClaudeSnapshot(snapshot({ status: "idle" }), targets);
  expect(terminal.notifyDone).not.toHaveBeenCalled();
});

it("never subscribes to legacy parent/child hooks in official observation mode", async () => {
  const { loadData } = await import("../../core/persistence");
  const { listen } = await import("../../core/api");
  vi.mocked(loadData).mockResolvedValue(null);
  await useStore.getState().init();
  expect(listen).not.toHaveBeenCalledWith("session-state-changed", expect.any(Function));
});

it("maps official snapshots through real store, clears hook details and deduplicates observed turn notifications", () => {
  const targets = useStore.getState().captureObservationTargets();
  useStore.setState({ sessionSubagents: { exact: [{ id: "old", label: "old", status: "running", updatedAt: 1 }] }, sessionTools: { exact: "old tool" }, sessionPendingCompletions: { exact: { session_id: "exact", state: "idle", ts: 1 } } });
  useStore.getState().applyClaudeSnapshot(snapshot({ status: "busy" }), targets);
  expect(useStore.getState().sessionStates.exact).toBe("working");
  expect(useStore.getState().sessionTools).toEqual({});
  expect(useStore.getState().sessionSubagents).toEqual({});
  expect(useStore.getState().sessionPendingCompletions).toEqual({});
  useStore.getState().applyClaudeSnapshot(snapshot({ status: "idle" }), targets);
  useStore.getState().applyClaudeSnapshot(snapshot({ status: "idle" }), targets);
  expect(terminal.notifyDone).toHaveBeenCalledOnce();
  expect(useStore.getState().projects[0].sessions[0].unread).toBe(true);
  expect(Reflect.get(claude, "enableSessionHooks")).not.toHaveBeenCalled();
});
