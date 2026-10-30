import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../core/persistence", () => ({ loadData: vi.fn().mockResolvedValue(null), debouncedSave: vi.fn() }));
vi.mock("../../core/api", () => ({ pty: { killSilent: vi.fn() }, scrollback: { clear: vi.fn() }, terminal: { notifyDone: vi.fn() }, listen: vi.fn() }));
import { useStore } from "../../core/store";
import { listen, terminal } from "../../core/api";
import { buildSupervision } from "../../core/supervision";
const children = { c: [{ id: "old", label: "Explore", status: "running" as const, updatedAt: 1 }] };
const row = () => { const s = useStore.getState(); return buildSupervision(s.projects, s.sessionStates, s.sessionTools, s.sessionSubagents)[0]; };
beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ projects: [{ id: "p", name: "Project", dir: "/p", sessions: [{ id: "s", name: "main", claudeSessionId: "c", runtimeStatus: "running" }] }], activePid: "p", activeSid: "other", sessionStates: {}, sessionTools: { c: "Read" }, sessionSubagents: children, sessionPendingCompletions: { c: { session_id: "c", state: "idle", ts: 1 } } });
});
describe("legacy child telemetry is not an official observation source", () => {
  it("does not listen for old parent/child hook events at initialization", async () => {
    await useStore.getState().init();
    expect(listen).not.toHaveBeenCalledWith("session-state-changed", expect.any(Function));
    expect(useStore.getState().sessionSubagents).toEqual({});
    expect(useStore.getState().sessionPendingCompletions).toEqual({});
  });
  it("old child data cannot fake parent work, tool labels, or observation availability", () => {
    expect(row()).toMatchObject({ status: "unknown", tool: undefined });
    useStore.setState({ sessionStates: { c: "idle" } });
    expect(row().status).toBe("idle");
    expect(terminal.notifyDone).not.toHaveBeenCalled();
  });
  it("missing official entries clear stale parent and child details without announcing completion", () => {
    useStore.setState({ sessionStates: { c: "working" } });
    useStore.getState().applyClaudeSnapshot({ available: true, sessions: [] }, useStore.getState().captureObservationTargets());
    expect(row().status).toBe("unknown");
    expect(useStore.getState().sessionSubagents).toEqual({});
    expect(useStore.getState().sessionTools).toEqual({});
    expect(useStore.getState().sessionPendingCompletions).toEqual({});
    expect(terminal.notifyDone).not.toHaveBeenCalled();
  });
  it("official parent idle completes once without waiting for obsolete children", () => {
    useStore.setState({ sessionStates: { c: "working" } });
    const apply = () => useStore.getState().applyClaudeSnapshot({ available: true, sessions: [{ sessionId: "c", kind: "interactive", status: "idle" }] }, useStore.getState().captureObservationTargets());
    apply(); apply();
    expect(useStore.getState().sessionSubagents).toEqual({});
    expect(useStore.getState().sessionPendingCompletions).toEqual({});
    expect(useStore.getState().projects[0].sessions[0].unread).toBe(true);
    expect(terminal.notifyDone).toHaveBeenCalledOnce();
  });
  it.each(["exited", "failed"] as const)("stale children cannot resurrect a %s parent", (runtimeStatus) => {
    useStore.getState().setSessionRuntimeStatus("s", runtimeStatus);
    useStore.setState({ sessionSubagents: children, sessionStates: { c: "working" } });
    expect(row().status).toBe(runtimeStatus);
    expect(terminal.notifyDone).not.toHaveBeenCalled();
  });
  it("legacy children do not block explicit archival of an officially idle parent", () => {
    useStore.setState({ sessionStates: { c: "idle" } });
    expect(useStore.getState().archiveSession("s", true)).toBe(true);
  });
});
