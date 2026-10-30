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
const child = (event = "SubagentStart", ts = 1001, extra = {}) => emit(JSON.stringify({
  session_id: "c", hook_event_name: event, agent_id: "a", agent_type: "Explore", ts, ...extra,
}));
beforeEach(async () => {
  vi.restoreAllMocks(); vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(1000);
  vi.mocked(loadData).mockResolvedValue(null);
  await useStore.getState().init();
  const calls = vi.mocked(listen).mock.calls;
  emit = calls[calls.length - 1][1] as (raw: string) => void;
  useStore.setState({
    projects: [{ id: "p", name: "Project", dir: "/p", sessions: [{ id: "s", name: "main", claudeSessionId: "c", runtimeStatus: "running" }] }],
    activePid: "p", activeSid: "s", sessionStates: { c: "working" }, sessionTools: {},
    settings: { ...useStore.getState().settings, autoNotifications: true },
  });
});

describe("observed Claude subagents", () => {
  it("accepts missing optional agent type from the native hook and retains an existing readable label", () => {
    child();
    child("SubagentStop", 1002, { agent_type: null });
    expect(useStore.getState().sessionSubagents.c[0]).toMatchObject({ label: "Explore", status: "stopped" });
  });
  it("does not announce parent completion while an observed child is still running", () => {
    useStore.setState({ activeSid: "elsewhere" });
    child();
    emit(JSON.stringify({ session_id: "c", state: "idle", ts: 1002 }));
    expect(terminal.notifyDone).not.toHaveBeenCalled();
    expect(useStore.getState().projects[0].sessions[0].unread).not.toBe(true);
  });
  it("announces the deferred parent idle exactly once when the last known-running child stops", () => {
    useStore.setState({ activeSid: "elsewhere" });
    const completed = vi.fn();
    window.addEventListener("session-completed", completed);
    child();
    child("SubagentStart", 1002, { agent_id: "b" });
    emit(JSON.stringify({ session_id: "c", state: "idle", ts: 1003 }));
    child("SubagentStop", 1004);
    expect(terminal.notifyDone).not.toHaveBeenCalled();
    child("SubagentStop", 1005, { agent_id: "b" });
    expect(useStore.getState().projects[0].sessions[0].unread).toBe(true);
    expect(useStore.getState().sessionStates.c).toBe("idle");
    expect(terminal.notifyDone).toHaveBeenCalledExactlyOnceWith("Project — main");
    expect(completed).toHaveBeenCalledTimes(1);
    child("SubagentStop", 1006, { agent_id: "b" });
    emit(JSON.stringify({ session_id: "c", state: "idle", ts: 1007 }));
    expect(terminal.notifyDone).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledTimes(1);
    window.removeEventListener("session-completed", completed);
  });
  it.each(["exit", "failure", "restart", "remove", "remove-project", "archive", "conversation", "init"])("discards deferred completion on %s", async (action) => {
    useStore.setState({ activeSid: "elsewhere" });
    child();
    emit(JSON.stringify({ session_id: "c", state: "idle", ts: 1002 }));
    expect(useStore.getState().sessionPendingCompletions.c).toBeDefined();
    const store = useStore.getState();
    if (action === "exit") store.setSessionRuntimeStatus("s", "exited");
    if (action === "failure") store.setSessionRuntimeStatus("s", "failed", "spawn");
    if (action === "restart") store.setSessionRuntimeStatus("s", "running");
    if (action === "remove") store.removeSession("s");
    if (action === "remove-project") {
      useStore.setState({ projects: [...store.projects, { id: "other", name: "Other", dir: "/other", sessions: [{ id: "other-s", name: "main" }] }] });
      store.removeProject("p");
    }
    if (action === "archive") {
      // Observation availability may disappear independently; archive must discard the pending signal too.
      useStore.setState({ sessionSubagents: {} });
      expect(store.archiveSession("s", true)).toBe(true);
      store.restoreSession("s");
    }
    if (action === "conversation") store.setClaudeSessionId("s", "new-c");
    if (action === "init") await store.init();
    expect(useStore.getState().sessionPendingCompletions.c).toBeUndefined();
    child("SubagentStop", 1003);
    expect(terminal.notifyDone).not.toHaveBeenCalled();
  });
  it.each(["working", "waiting"] as const)("does not overwrite a newer parent %s with a child stop", (state) => {
    useStore.setState({ activeSid: "elsewhere" });
    child();
    emit(JSON.stringify({ session_id: "c", state: "idle", ts: 1002 }));
    emit(JSON.stringify({ session_id: "c", state, ts: 1003 }));
    child("SubagentStop", 1004);
    expect(useStore.getState().sessionStates.c).toBe(state);
    expect(useStore.getState().sessionPendingCompletions.c).toBeUndefined();
    expect(useStore.getState().projects[0].sessions[0].unread).not.toBe(true);
    expect(terminal.notifyDone).not.toHaveBeenCalled();
  });
  it("keeps an activated session read when its deferred completion arrives", () => {
    useStore.setState({ activeSid: "elsewhere" });
    child();
    emit(JSON.stringify({ session_id: "c", state: "idle", ts: 1002 }));
    useStore.getState().setActiveSession("s");
    child("SubagentStop", 1003);
    expect(useStore.getState().projects[0].sessions[0].unread).toBe(false);
    expect(useStore.getState().sessionPendingCompletions.c).toBeUndefined();
    expect(terminal.notifyDone).not.toHaveBeenCalled();
  });
  it("marks a background deferred result unread even with notifications disabled", () => {
    useStore.setState({ activeSid: "elsewhere", settings: { ...useStore.getState().settings, autoNotifications: false } });
    child();
    emit(JSON.stringify({ session_id: "c", state: "idle", ts: 1002 }));
    child("SubagentStop", 1003);
    expect(useStore.getState().projects[0].sessions[0].unread).toBe(true);
    expect(terminal.notifyDone).not.toHaveBeenCalled();
  });
  it("rejects a child stop older than its start while retaining the deferred result", () => {
    useStore.setState({ activeSid: "elsewhere" });
    child("SubagentStart", 1010);
    emit(JSON.stringify({ session_id: "c", state: "idle", ts: 1011 }));
    child("SubagentStop", 1009);
    expect(useStore.getState().sessionSubagents.c[0].status).toBe("running");
    expect(terminal.notifyDone).not.toHaveBeenCalled();
    child("SubagentStop", 1010); // independent child ordering permits an earlier observed stop delivered late
    expect(useStore.getState().projects[0].sessions[0].unread).toBe(true);
    expect(terminal.notifyDone).toHaveBeenCalledTimes(1);
  });
  it("never treats an unmatched stop as parent completion", () => {
    useStore.setState({ activeSid: "elsewhere", sessionStates: { c: "idle" } });
    child("SubagentStop", 1002);
    expect(useStore.getState().projects[0].sessions[0].unread).not.toBe(true);
    expect(terminal.notifyDone).not.toHaveBeenCalled();
  });
  it("refuses to archive a parent whose observed child is still running", () => {
    child();
    useStore.setState({ sessionStates: { c: "idle" } });
    expect(useStore.getState().archiveSession("s", true)).toBe(false);
  });
  it("records a stop even if start was missed, and never infers success or invents a duration", () => {
    child("SubagentStop");
    expect(useStore.getState().sessionSubagents.c).toEqual([
      { id: "a", label: "Explore", status: "stopped", updatedAt: 1001 },
    ]);
    child("SubagentStart", 1000);
    expect(useStore.getState().sessionSubagents.c[0].status).toBe("stopped");
  });
  it("orders each child independently of parent and siblings and lets same-millisecond stop settle a start", () => {
    emit(JSON.stringify({ session_id: "c", state: "working", ts: 1010 }));
    child("SubagentStart", 1002);
    child("SubagentStart", 1001, { agent_id: "b" });
    child("SubagentStart", 1002);
    child("SubagentStop", 1002);
    child("SubagentStart", 1003); // an observed stop is terminal for this child identity
    expect(useStore.getState().sessionSubagents.c).toHaveLength(2);
    expect(useStore.getState().sessionSubagents.c.find((a) => a.id === "a")).toMatchObject({ status: "stopped", startedAt: 1002 });
    expect(useStore.getState().sessionSubagents.c.find((a) => a.id === "b")?.status).toBe("running");
    expect(terminal.notifyDone).not.toHaveBeenCalled();
  });
  it.each([{ agent_id: "" }, { agent_id: 42 }, { agent_type: {} }, { ts: 0 }, { ts: "1000" }, { session_id: "other" }])("ignores malformed or foreign observations %j", (extra) => {
    child("SubagentStart", 1001, extra);
    expect(useStore.getState().sessionSubagents).toEqual({});
  });
  it("fences old events on restart and marks previously live children unknown on process exit", () => {
    child();
    useStore.getState().setSessionRuntimeStatus("s", "exited");
    expect(useStore.getState().sessionSubagents.c[0].status).toBe("unknown");
    child("SubagentStop", 1002);
    expect(useStore.getState().sessionSubagents.c[0].status).toBe("unknown");
    vi.spyOn(Date, "now").mockReturnValue(2000);
    useStore.getState().setSessionRuntimeStatus("s", "running");
    child("SubagentStart", 1999);
    expect(useStore.getState().sessionSubagents.c).toBeUndefined();
    child("SubagentStart", 2001);
    expect(useStore.getState().sessionSubagents.c[0].status).toBe("running");
  });
  it("ignores child-shaped tool and Stop messages rather than changing the parent", () => {
    emit(JSON.stringify({ session_id: "c", state: "idle", hook_event_name: "Stop", agent_id: "a", ts: 1002 }));
    expect(useStore.getState().sessionStates.c).toBe("working");
    expect(useStore.getState().projects[0].sessions[0].unread).not.toBe(true);
  });
  it("attaches a child to its actual conversation without changing the parent state", () => {
    child();
    expect(useStore.getState().sessionSubagents.c).toEqual([
      { id: "a", label: "Explore", status: "running", startedAt: 1001, updatedAt: 1001 },
    ]);
    expect(useStore.getState().sessionStates.c).toBe("working");
    expect(terminal.notifyDone).not.toHaveBeenCalled();
  });
});
