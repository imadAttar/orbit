import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../core/persistence", () => ({ loadData: vi.fn(), debouncedSave: vi.fn() }));
vi.mock("../../core/api", () => ({
  pty: { killSilent: vi.fn() }, scrollback: { clear: vi.fn() },
  terminal: { notifyDone: vi.fn() }, listen: vi.fn().mockResolvedValue(() => {}),
}));
import { useStore } from "../../core/store";
import { listen, terminal } from "../../core/api";
import { loadData } from "../../core/persistence";

let emit: (raw: string) => void;
const hook = (state: unknown, ts: unknown = Date.now(), extra = {}) =>
  emit(JSON.stringify({ session_id: "c", state, ts, ...extra }));
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(1000);
  vi.mocked(loadData).mockResolvedValue(null);
  await useStore.getState().init();
  emit = vi.mocked(listen).mock.calls[vi.mocked(listen).mock.calls.length - 1][1] as (raw: string) => void;
  useStore.setState({
    projects: [{ id: "p", name: "Project", dir: "/p", sessions: [{ id: "s", name: "main", claudeSessionId: "c", runtimeStatus: "running" }] }],
    activePid: "p", activeSid: "other", sessionStates: {}, sessionTools: {},
    settings: { ...useStore.getState().settings, autoNotifications: true },
  });
});
describe("session hook lifecycle", () => {
  it.each(["bogus", null, 42])("rejects invalid state %s", (state) => {
    hook(state);
    expect(useStore.getState().sessionStates.c).toBeUndefined();
  });
  it.each([null, "1000", -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid timestamp %s", (ts) => {
    hook("working", ts);
    expect(useStore.getState().sessionStates.c).toBeUndefined();
  });
  it("rejects missing legacy timestamps rather than guessing freshness", () => {
    emit(JSON.stringify({ session_id: "c", state: "working" }));
    expect(useStore.getState().sessionStates.c).toBeUndefined();
  });
  it("ignores older and equal timestamps including tools and completion side effects", () => {
    hook("working", 1000);
    hook("working", 1002, { tool: "Read" });
    hook("idle", 1001, { tool: "Write" });
    hook("waiting", 1002);
    expect(useStore.getState().sessionStates.c).toBe("working");
    expect(useStore.getState().sessionTools.c).toBe("Read");
    expect(terminal.notifyDone).not.toHaveBeenCalled();
  });
  it("rejects hooks older than a restart even if no earlier hook was received", () => {
    useStore.getState().setSessionRuntimeStatus("s", "running");
    hook("idle", 999);
    expect(useStore.getState().sessionStates.c).toBeUndefined();
  });
  it("ignores archived sessions", () => {
    useStore.getState().archiveSession("s", true);
    hook("working", 1001, { tool: "Read" });
    expect(useStore.getState().sessionStates.c).toBeUndefined();
    expect(useStore.getState().sessionTools.c).toBeUndefined();
  });
  it("does not notify when automatic notifications are disabled but still records completion", () => {
    useStore.getState().updateSettings({ autoNotifications: false });
    hook("working", 1000);
    hook("idle", 1001);
    expect(useStore.getState().sessionStates.c).toBe("idle");
    expect(useStore.getState().projects[0].sessions[0].unread).toBe(true);
    expect(terminal.notifyDone).not.toHaveBeenCalled();
  });
  it("notifies once for a permitted background completion, not for duplicate delivery", () => {
    hook("working", 1000);
    hook("idle", 1001);
    hook("idle", 1001);
    expect(terminal.notifyDone).toHaveBeenCalledExactlyOnceWith("Project — main");
  });
  it.each(["exited", "failed"] as const)("ignores a late hook after %s without tools or notifications", (status) => {
    hook("working");
    useStore.getState().setSessionRuntimeStatus("s", status);
    hook("idle", 1001, { tool: "Read" });
    expect(useStore.getState().sessionStates.c).toBeUndefined();
    expect(useStore.getState().sessionTools.c).toBeUndefined();
    expect(terminal.notifyDone).not.toHaveBeenCalled();
  });
  it("accepts working again after exit and restart using the actual store state", () => {
    hook("working");
    useStore.getState().setSessionRuntimeStatus("s", "exited");
    useStore.getState().setSessionRuntimeStatus("s", "running");
    hook("working", 1001);
    expect(useStore.getState().sessionStates.c).toBe("working");
  });
});
