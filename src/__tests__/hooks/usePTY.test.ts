import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(), kill: vi.fn(), resize: vi.fn(), fit: vi.fn(), dimensions: { cols: 80, rows: 24 },
  write: vi.fn(), listen: vi.fn(), track: vi.fn(), generateTitle: vi.fn(),
  mark: vi.fn(), rename: vi.fn(), setId: vi.fn(), dangerous: vi.fn(), runtime: vi.fn(), output: vi.fn(),
  save: vi.fn(), dispose: vi.fn(),
  onData: undefined as undefined | ((data: string) => void),
  state: {} as any,
}));
vi.mock("@xterm/xterm", () => ({ Terminal: class {
  options = {}; buffer = { active: { getLine: () => undefined } };
  loadAddon() {} open() {} write(data: string) { mocks.output(data); } registerLinkProvider() {} dispose() { mocks.dispose(); }
  onData(cb: (data: string) => void) { mocks.onData = cb; }
  attachCustomKeyEventHandler() {}
} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() { mocks.fit(); } proposeDimensions() { return mocks.dimensions; } } }));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class {} }));
vi.mock("@xterm/addon-serialize", () => ({ SerializeAddon: class {} }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ readText: vi.fn(), writeText: vi.fn() }));
vi.mock("../../features/terminal/hooks/useScrollback", () => ({ useScrollback: () => ({ current: mocks.save }) }));
vi.mock("../../features/terminal/hooks/terminalKeyHandler", () => ({ createTerminalKeyEventHandler: vi.fn() }));
vi.mock("../../lib/analytics", () => ({ trackEvent: mocks.track }));
vi.mock("../../core/store", () => ({ useStore: Object.assign((selector: any) => selector(mocks.state), { getState: () => mocks.state }) }));
vi.mock("../../core/api", () => ({
  pty: { spawn: mocks.spawn, kill: mocks.kill, write: mocks.write, resize: mocks.resize },
  terminal: { openInEditor: vi.fn() },
  scrollback: { load: vi.fn().mockResolvedValue(null), clear: vi.fn() },
  listen: mocks.listen, claude: { generateTitle: mocks.generateTitle },
}));
import { usePTY } from "../../features/terminal/hooks/usePTY";
import * as terminalParser from "../../lib/terminalParser";
const mount = (overrides = {}) => renderHook(() => usePTY({
  sessionId: "s1", projectDir: "/private/project", containerRef: { current: document.createElement("div") },
  activated: true, restoreChoice: "fresh", modeChoice: "normal", generation: 0,
  isVisible: false, jumpRef: { current: vi.fn() }, onSpawned: vi.fn(), spawned: false,
  t: ((key: string) => key) as any, ...overrides,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.onData = undefined;
  mocks.spawn.mockResolvedValue(undefined);
  mocks.kill.mockResolvedValue(undefined);
  mocks.resize.mockResolvedValue(undefined);
  mocks.dimensions = { cols: 80, rows: 24 };
  mocks.write.mockResolvedValue(undefined);
  mocks.listen.mockResolvedValue(vi.fn());
  mocks.generateTitle.mockResolvedValue("Local title");
  mocks.state = {
    settings: { theme: "orbit", fontSize: 12 },
    projects: [{ sessions: [{ id: "s1", name: "session-1", claudeSessionId: "c1" }] }],
    sessionCosts: {}, markConversationStarted: mocks.mark, renameSession: mocks.rename,
    setClaudeSessionId: mocks.setId, setDangerousMode: mocks.dangerous,
    setSessionRuntimeStatus: mocks.runtime,
    updateSessionCost: vi.fn(),
  };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const ready = async () => { await vi.waitFor(() => expect(mocks.onData).toBeTypeOf("function")); };

describe("usePTY input", () => {
  it("reports worker failures only for the current session generation and disposes the listener", async () => {
    const onInputError = vi.fn();
    const stop = vi.fn();
    mocks.listen.mockImplementation((event) => Promise.resolve(event === "pty-input-error" ? stop : vi.fn()));
    const view = mount({ onInputError }); await ready();
    const generation = mocks.spawn.mock.calls[0][0].generationId;
    const report = mocks.listen.mock.calls.find(([event]) => event === "pty-input-error")?.[1];
    expect(report).toBeTypeOf("function");
    report!({ session_id: "other", generation_id: generation });
    report!({ session_id: "s1", generation_id: "old" });
    expect(onInputError).not.toHaveBeenCalled();
    report!({ session_id: "s1", generation_id: generation });
    expect(onInputError).toHaveBeenCalledOnce();
    view.unmount();
    expect(stop).toHaveBeenCalledOnce();
    report!({ session_id: "s1", generation_id: generation });
    expect(onInputError).toHaveBeenCalledOnce();
  });
  it("reports rejected input to the owning terminal instead of silently dropping it", async () => {
    const onInputError = vi.fn();
    mocks.write.mockRejectedValue(new Error("input queue full"));
    mount({ onInputError }); await ready();
    mocks.onData!("large paste");
    await vi.waitFor(() => expect(onInputError).toHaveBeenCalledOnce());
  });
  it("never overwrites a user-chosen session title on the next prompt", async () => {
    mocks.state.projects[0].sessions[0].name = "Client kickoff";
    mount({ restoreChoice: "resume" }); await ready();
    mocks.onData!("a new private prompt"); mocks.onData!("\r");
    await Promise.resolve();
    expect(mocks.generateTitle).not.toHaveBeenCalled();
    expect(mocks.rename).not.toHaveBeenCalled();
  });
  it("never treats Enter (including shell commands) as confirmed agent prompts", async () => {
    const { unmount } = mount({ sessionType: "terminal" });
    await ready();
    mocks.onData!("\r"); mocks.onData!("echo secret"); mocks.onData!("\r");
    unmount();
    expect(mocks.track.mock.calls.map(([name]) => name)).not.toContain("prompt_sent");
    expect(mocks.mark).not.toHaveBeenCalled();
  });
  it("continues buffering meaningful input after title generation", async () => {
    mount(); await ready();
    for (const c of "first prompt") mocks.onData!(c);
    mocks.onData!("\r");
    mocks.mark.mockClear();
    for (const c of "second") mocks.onData!(c);
    mocks.onData!("\r");
    expect(mocks.mark).toHaveBeenCalledOnce();
  });
  it("uses multiline bracketed paste for a local title only on submit", async () => {
    mount(); await ready();
    mocks.onData!("\x1b[200~fix private\nproject bug\x1b[201~");
    expect(mocks.generateTitle).not.toHaveBeenCalled();
    mocks.onData!("\r");
    await vi.waitFor(() => expect(mocks.generateTitle).toHaveBeenCalledWith("fix private\nproject bug"));
    expect(mocks.mark).toHaveBeenCalledWith("s1");
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain("private");
  });
});

describe("usePTY lifecycle", () => {
  it("skips cost parsing for ordinary output without missing the following cost line", async () => {
    mount(); await ready();
    const scan = vi.spyOn(terminalParser, "stripAnsi");
    const clock = vi.spyOn(Date, "now").mockReturnValue(5000);
    const output = mocks.listen.mock.calls.find(([event]) => event === "pty-output")![1];
    for (let i = 0; i < 100; i++) output({ session_id: "s1", data: "agent progress\r\n" });
    expect(scan).not.toHaveBeenCalled();
    expect(mocks.output).toHaveBeenCalledTimes(100);
    clock.mockReturnValue(6001);
    output({ session_id: "s1", data: "Cost: $1.25" });
    expect(scan).toHaveBeenCalledTimes(1);
    expect(mocks.state.updateSessionCost).toHaveBeenCalledWith("s1", 1.25);
  });
  it("does not interpret shell output currency as agent session cost", async () => {
    mount({ sessionType: "terminal" }); await ready();
    const output = mocks.listen.mock.calls.find(([event]) => event === "pty-output")![1];
    output({ session_id: "s1", data: "Invoice total: $25.00" });
    expect(mocks.output).toHaveBeenCalledWith("Invoice total: $25.00");
    expect(mocks.state.updateSessionCost).not.toHaveBeenCalled();
  });
  it("saves the outgoing terminal before disposing it during a generation change", async () => {
    const options = { generation: 0 };
    const hook = mount(options); await ready();
    mocks.save.mockClear(); mocks.dispose.mockClear();
    options.generation = 1;
    hook.rerender();
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.dispose.mock.invocationCallOrder[0]);
  });
  it("fits and resizes to current dimensions after a deferred spawn", async () => {
    let resolve!: () => void;
    mocks.spawn.mockReturnValueOnce(new Promise<void>(r => { resolve = r; }));
    mount({ sessionType: "terminal" });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    mocks.dimensions = { cols: 110, rows: 40 }; mocks.fit.mockClear();
    resolve(); await ready();
    expect(mocks.fit).toHaveBeenCalled();
    expect(mocks.resize).toHaveBeenCalledWith("s1", 110, 40);
  });
  it("resizes the live PTY after a font size change", async () => {
    const hook = mount(); await ready();
    mocks.fit.mockClear(); mocks.resize.mockClear();
    mocks.state.settings.fontSize = 18;
    mocks.dimensions = { cols: 60, rows: 18 };
    hook.rerender();
    expect(mocks.fit).toHaveBeenCalled();
    expect(mocks.resize).toHaveBeenCalledWith("s1", 60, 18);
  });
  it.each(["claude", "terminal"] as const)("kills only the cancelled %s generation when its deferred spawn resolves", async (sessionType) => {
    let resolve!: () => void;
    mocks.spawn.mockReturnValueOnce(new Promise<void>(r => { resolve = r; }));
    const old = mount({ sessionType });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    const oldGeneration = mocks.spawn.mock.calls[0][0].generationId;
    const oldOutput = mocks.listen.mock.calls.find(([event]) => event === "pty-output")![1];
    const oldExit = mocks.listen.mock.calls.find(([event]) => event === "pty-exit")![1];
    old.unmount();
    mount({ sessionType }); await ready();
    const newGeneration = mocks.spawn.mock.calls[1][0].generationId;
    mocks.kill.mockClear(); mocks.runtime.mockClear(); mocks.output.mockClear();
    resolve();
    await vi.waitFor(() => expect(mocks.kill).toHaveBeenCalledWith("s1", oldGeneration));
    expect(mocks.kill).not.toHaveBeenCalledWith("s1", newGeneration);
    oldOutput({ session_id: "s1", generation_id: oldGeneration, data: "late old output" });
    oldExit({ session_id: "s1", generation_id: oldGeneration, exit_code: 1 });
    const newExit = mocks.listen.mock.calls.filter(([event]) => event === "pty-exit")[1][1];
    newExit({ session_id: "s1", generation_id: oldGeneration, exit_code: 1 });
    expect(mocks.output).not.toHaveBeenCalled();
    expect(mocks.runtime).not.toHaveBeenCalled();
  });
  it("keeps early output and rejects queued output from a replaced PTY generation", async () => {
    mocks.spawn.mockImplementationOnce(async (args) => {
      const output = mocks.listen.mock.calls.find(([event]) => event === "pty-output")![1];
      output({ session_id: "s1", generation_id: "old", data: "stale" });
      output({ session_id: "s1", generation_id: args.generationId, data: "first bytes" });
    });
    mount(); await ready();
    expect(mocks.output).toHaveBeenCalledWith("first bytes");
    expect(mocks.output).not.toHaveBeenCalledWith("stale");
    expect(mocks.runtime).toHaveBeenCalledWith("s1", "running");
  });
  it("reports a real nonzero process exit and stops accepting input", async () => {
    mount({ restoreChoice: "resume" }); await ready();
    const exit = mocks.listen.mock.calls.find(([event]) => event === "pty-exit")?.[1];
    expect(exit).toBeTypeOf("function");
    const generation = mocks.spawn.mock.calls[0][0].generationId;
    exit({ session_id: "s1", generation_id: generation, exit_code: 1 });
    expect(mocks.runtime).toHaveBeenCalledWith("s1", "failed", "resume");
    mocks.write.mockClear(); mocks.onData!("secret");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("measures actual resume attempt and successful PTY launch, not user choice", async () => {
    mount({ restoreChoice: "resume" }); await ready();
    expect(mocks.track).toHaveBeenCalledWith("session_resume_attempted", { sessionType: "agent" });
    expect(mocks.track).toHaveBeenCalledWith("session_resume_launched", { sessionType: "agent" });
    expect(mocks.track.mock.calls.map(([name]) => name)).not.toContain("session_resume_succeeded");
    expect(mocks.spawn).toHaveBeenCalledWith(expect.objectContaining({ resumeMode: true }));
  });
  it("does not report resume when a saved agent id does not exist", async () => {
    mocks.state.projects[0].sessions[0].claudeSessionId = undefined;
    mount({ restoreChoice: "resume" }); await ready();
    expect(mocks.track.mock.calls.map(([name]) => name)).not.toContain("session_resume_attempted");
  });
  it("never reports terminal relaunch as agent resume", async () => {
    mount({ restoreChoice: "resume", sessionType: "terminal" }); await ready();
    expect(mocks.track).toHaveBeenCalledWith("pty_spawned", { restore: 0, sessionType: "terminal" });
    expect(mocks.track.mock.calls.map(([name]) => name)).not.toContain("session_resume_attempted");
  });
  it("normalizes spawn errors, reports failed resume, and signals failure to UI", async () => {
    mocks.spawn.mockRejectedValueOnce(new Error("/Users/private secret"));
    const onSpawned = vi.fn();
    mount({ restoreChoice: "resume", onSpawned });
    await vi.waitFor(() => expect(mocks.track).toHaveBeenCalledWith("pty_error", { errorCode: "spawn_failed", sessionType: "agent" }));
    expect(mocks.track).toHaveBeenCalledWith("session_resume_failed", { sessionType: "agent", errorCode: "spawn_failed" });
    expect(onSpawned).toHaveBeenCalledWith(false);
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain("private");
  });
  it("measures observed hook activity, never business success", async () => {
    let now = 100;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    mount({ restoreChoice: "resume" }); await ready();
    const listener = mocks.listen.mock.calls.find(([event]) => event === "session-state-changed")?.[1];
    expect(listener).toBeTypeOf("function");
    listener(JSON.stringify({ session_id: "c1", state: "idle" }));
    listener(JSON.stringify({ session_id: "other", state: "working" }));
    listener(JSON.stringify({ session_id: "c1", state: "working" }));
    now = 200;
    listener(JSON.stringify({ session_id: "c1", state: "working" }));
    now = 350;
    listener(JSON.stringify({ session_id: "c1", state: "idle" }));
    expect(mocks.track).toHaveBeenCalledWith("agent_activity_ended", { sessionType: "agent", signal: "session_hook", outcome: "idle", durationMs: 250 });
    expect(mocks.track.mock.calls.filter(([event]) => event === "agent_activity_started")).toHaveLength(1);
    expect(mocks.track).toHaveBeenCalledWith("session_resume_succeeded", { sessionType: "agent" });
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain("business_success");
    vi.restoreAllMocks();
  });

  it("does not spawn after an asynchronous listener resolves following unmount", async () => {
    let resolve!: (fn: () => void) => void;
    mocks.listen.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const { unmount } = mount();
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalled());
    unmount(); const unlisten = vi.fn(); resolve(unlisten);
    await Promise.resolve(); await Promise.resolve();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
