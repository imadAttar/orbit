import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../core/persistence", () => ({ loadData: vi.fn(), debouncedSave: vi.fn() }));
vi.mock("../../core/api", () => ({
  pty: { killSilent: vi.fn() }, scrollback: { clear: vi.fn() },
  terminal: { notifyDone: vi.fn() }, listen: vi.fn().mockResolvedValue(() => {}),
}));
import { useStore } from "../../core/store";
import { debouncedSave } from "../../core/persistence";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  useStore.setState({
    loaded: true,
    projects: [
      { id: "p", name: "Project", dir: "/p", sessions: [
        { id: "s", name: "main", claudeSessionId: "c", runtimeStatus: "running", hasConversation: true, pinned: true },
        { id: "s2", name: "other", claudeSessionId: "c2" },
      ] },
      { id: "q", name: "Other project", dir: "/q", sessions: [{ id: "t", name: "main", claudeSessionId: "d" }] },
    ],
    activePid: "q", activeSid: "t", projectSessions: { p: "s", q: "t" },
    sessionSubagents: {
      c: [{ id: "child", label: "Explore", status: "running", updatedAt: 100 }],
      c2: [{ id: "child2", label: "Explore", status: "stopped", updatedAt: 100 }],
      d: [{ id: "other", label: "Explore", status: "running", updatedAt: 100 }],
    },
    sessionStates: { c: "waiting", c2: "idle", d: "working" },
    sessionTools: { c: "Read", c2: "Grep", d: "Bash" },
    sessionHookTimestamps: { c: 100, c2: 100, d: 100 },
    sessionRuntimeStartedAt: { s: 50, s2: 50, t: 50 },
    sessionCosts: { s: 1, s2: 2, t: 3 },
  });
});

function expectOtherProjectUnchanged() {
  const state = useStore.getState();
  expect(state.sessionSubagents.d).toEqual([{ id: "other", label: "Explore", status: "running", updatedAt: 100 }]);
  expect(state.sessionStates.d).toBe("working");
  expect(state.sessionTools.d).toBe("Bash");
  expect(state.sessionHookTimestamps.d).toBe(100);
  expect(state.sessionRuntimeStartedAt.t).toBe(50);
  expect(state.sessionCosts.t).toBe(3);
  expect(state.activePid).toBe("q");
  expect(state.activeSid).toBe("t");
  expect(state.projectSessions.q).toBe("t");
}

function expectConversationRemoved(claudeId: string, sid: string) {
  const state = useStore.getState();
  expect(state.sessionSubagents[claudeId]).toBeUndefined();
  expect(state.sessionStates[claudeId]).toBeUndefined();
  expect(state.sessionTools[claudeId]).toBeUndefined();
  expect(state.sessionHookTimestamps[claudeId]).toBe(100);
  expect(state.sessionRuntimeStartedAt[sid]).toBe(50);
  expect(state.sessionCosts[sid]).toBeUndefined();
}

describe("observation lifecycle cleanup", () => {
  it("starts a runtime without stale live observations while preserving conversation metadata", () => {
    vi.spyOn(Date, "now").mockReturnValue(2000);
    const previous = useStore.getState().projects[0].sessions[0];
    useStore.getState().setSessionRuntimeStatus("s", "running");
    const state = useStore.getState();
    expect(state.sessionStates.c).toBeUndefined();
    expect(state.sessionTools.c).toBeUndefined();
    expect(state.sessionHookTimestamps.c).toBeUndefined();
    expect(state.sessionSubagents.c).toBeUndefined();
    expect(state.sessionRuntimeStartedAt.s).toBe(2000);
    expect(state.sessionCosts.s).toBe(1);
    expect(state.projects[0].sessions[0]).toEqual({ ...previous, lastActivityAt: 2000, failureReason: undefined });
    expectOtherProjectUnchanged();
    expect(state.sessionSubagents.c2).toHaveLength(1);
  });
  it("drops both old and stale replacement observations when Claude identity changes", () => {
    const previous = useStore.getState().projects[0].sessions[0];
    const stale = useStore.getState();
    useStore.setState({
      sessionSubagents: { ...stale.sessionSubagents, replacement: stale.sessionSubagents.c },
      sessionStates: { ...stale.sessionStates, replacement: "waiting" },
      sessionTools: { ...stale.sessionTools, replacement: "Read" },
      sessionHookTimestamps: { ...stale.sessionHookTimestamps, replacement: 9999 },
    });
    useStore.getState().setClaudeSessionId("s", "replacement");
    const state = useStore.getState();
    for (const id of ["c", "replacement"]) {
      expect(state.sessionSubagents[id]).toBeUndefined();
      expect(state.sessionStates[id]).toBeUndefined();
      expect(state.sessionTools[id]).toBeUndefined();
      expect(state.sessionHookTimestamps[id]).toBeUndefined();
    }
    expect(state.projects[0].sessions[0]).toEqual({ ...previous, claudeSessionId: "replacement" });
    expect(state.sessionRuntimeStartedAt.s).toBe(50);
    expectOtherProjectUnchanged();
    expect(state.sessionSubagents.c2).toHaveLength(1);
    expect(vi.mocked(debouncedSave).mock.lastCall?.[0].projects[0].sessions[0].claudeSessionId).toBe("replacement");
  });
  it("keeps live observations when the same Claude identity is reported again", () => {
    const previous = useStore.getState();
    useStore.getState().setClaudeSessionId("s", "c");
    expect(useStore.getState().sessionSubagents).toBe(previous.sessionSubagents);
    expect(useStore.getState().sessionStates).toBe(previous.sessionStates);
    expect(useStore.getState().sessionTools).toBe(previous.sessionTools);
    expect(useStore.getState().sessionHookTimestamps).toBe(previous.sessionHookTimestamps);
  });
  it("removes observations for every conversation in a deleted project only", () => {
    useStore.getState().removeProject("p");
    expectConversationRemoved("c", "s");
    expectConversationRemoved("c2", "s2");
    expectOtherProjectUnchanged();
    expect(useStore.getState().projectSessions).toEqual({ q: "t" });
    expect(vi.mocked(debouncedSave).mock.lastCall?.[0].projectSessions).toEqual({ q: "t" });
  });
  it("removes only the deleted conversation's transient observations", () => {
    useStore.getState().removeSession("s");
    expectConversationRemoved("c", "s");
    expectOtherProjectUnchanged();
    expect(useStore.getState().sessionSubagents.c2).toHaveLength(1);
    expect(useStore.getState().projectSessions.p).toBe("s2");
    expect(vi.mocked(debouncedSave).mock.lastCall?.[0].projectSessions).toEqual({ p: "s2", q: "t" });
  });
});
