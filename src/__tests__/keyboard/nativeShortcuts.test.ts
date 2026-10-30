import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ isMac: true }));
const state = vi.hoisted(() => ({
  projects: [{ id: "p1", sessions: [{ id: "s1" }] }], activePid: "p1", activeSid: "s1",
  settings: { fontSize: 14 }, addSession: vi.fn(), setActiveSession: vi.fn(), setFontSize: vi.fn(),
}));
vi.mock("../../lib/platform", () => platform);
vi.mock("../../core/store", () => ({ useStore: { getState: () => state } }));
vi.mock("../../lib/analytics", () => ({ trackEvent: vi.fn() }));
import { handleKeyboardShortcut } from "../../keyboard/keyboardHandler";

const callbacks = { showNewProject: vi.fn(), confirmDeleteSession: vi.fn(), toggleSearch: vi.fn(), showPreferences: vi.fn() };
function dispatch(key: string, options: KeyboardEventInit = {}, target?: HTMLElement) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  if (target) Object.defineProperty(event, "target", { value: target });
  handleKeyboardShortcut(event, callbacks);
  return event;
}
beforeEach(() => { vi.clearAllMocks(); platform.isMac = true; });

describe("Orbit shortcuts preserve native Claude input", () => {
  it.each(["n", "t", "w", "f", ",", "=", "-"])("leaves macOS Ctrl+%s to Claude", key => {
    expect(dispatch(key, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(state.addSession).not.toHaveBeenCalled();
    expect(state.setFontSize).not.toHaveBeenCalled();
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled();
  });
  it("still opens sessions with macOS Cmd+N and Windows/Linux Ctrl+N", () => {
    expect(dispatch("n", { metaKey: true }).defaultPrevented).toBe(true);
    platform.isMac = false;
    expect(dispatch("n", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(state.addSession).toHaveBeenCalledTimes(2);
  });
  it("does not hijack Alt-modified or composed key sequences", () => {
    expect(dispatch("n", { metaKey: true, altKey: true }).defaultPrevented).toBe(false);
    expect(dispatch("n", { metaKey: true, isComposing: true }).defaultPrevented).toBe(false);
    expect(state.addSession).not.toHaveBeenCalled();
  });
  it("does not create repeated sessions from a held shortcut", () => {
    dispatch("n", { metaKey: true, repeat: true });
    dispatch("t", { metaKey: true, repeat: true });
    expect(state.addSession).not.toHaveBeenCalled();
  });
  it("ignores keyboard events that another control already handled", () => {
    const event = new KeyboardEvent("keydown", { key: "n", metaKey: true, cancelable: true });
    event.preventDefault();
    handleKeyboardShortcut(event, callbacks);
    expect(state.addSession).not.toHaveBeenCalled();
  });
  it("does not steal shortcuts from ordinary text inputs", () => {
    expect(dispatch("n", { metaKey: true }, document.createElement("input")).defaultPrevented).toBe(false);
    expect(state.addSession).not.toHaveBeenCalled();
  });
  it("keeps application Cmd shortcuts available from the xterm input", () => {
    const input = document.createElement("textarea"); input.className = "xterm-helper-textarea";
    expect(dispatch("n", { metaKey: true }, input).defaultPrevented).toBe(true);
    expect(state.addSession).toHaveBeenCalledOnce();
  });
});
