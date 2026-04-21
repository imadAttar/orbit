import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TerminalKeyHandlerDeps } from "../../features/terminal/hooks/terminalKeyHandler";
import { createTerminalKeyEventHandler } from "../../features/terminal/hooks/terminalKeyHandler";

// Pre-mocked for Task 4/5 Windows-clipboard branches; current handler doesn't read platform.
vi.mock("../../lib/platform", () => ({
  isWindows: false,
  isMac: false,
  isLinux: true,
}));

function makeEvent(partial: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    key: partial.key,
    ctrlKey: partial.ctrlKey ?? false,
    metaKey: partial.metaKey ?? false,
    shiftKey: partial.shiftKey ?? false,
    altKey: partial.altKey ?? false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as KeyboardEvent;
}

describe("createTerminalKeyEventHandler — prompt navigation", () => {
  const term = {
    hasSelection: vi.fn(() => false),
    getSelection: vi.fn(() => ""),
    clearSelection: vi.fn(),
  };
  const pty = { write: vi.fn() };
  const jumpPrompt = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("intercepts Ctrl+ArrowUp and calls jumpPrompt('prev')", () => {
    const handler = createTerminalKeyEventHandler({
      sid: "s1",
      term: term as TerminalKeyHandlerDeps["term"],
      pty: pty as TerminalKeyHandlerDeps["pty"],
      jumpPrompt,
    });
    const e = makeEvent({ key: "ArrowUp", ctrlKey: true });
    const result = handler(e);
    expect(jumpPrompt).toHaveBeenCalledWith("prev");
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it("intercepts Cmd+ArrowDown and calls jumpPrompt('next')", () => {
    const handler = createTerminalKeyEventHandler({
      sid: "s1",
      term: term as TerminalKeyHandlerDeps["term"],
      pty: pty as TerminalKeyHandlerDeps["pty"],
      jumpPrompt,
    });
    const e = makeEvent({ key: "ArrowDown", metaKey: true });
    const result = handler(e);
    expect(jumpPrompt).toHaveBeenCalledWith("next");
    expect(result).toBe(false);
  });

  it("returns true (pass-through) for any other key combo", () => {
    const handler = createTerminalKeyEventHandler({
      sid: "s1",
      term: term as TerminalKeyHandlerDeps["term"],
      pty: pty as TerminalKeyHandlerDeps["pty"],
      jumpPrompt,
    });
    expect(handler(makeEvent({ key: "a" }))).toBe(true);
    expect(handler(makeEvent({ key: "Enter" }))).toBe(true);
    expect(handler(makeEvent({ key: "c", ctrlKey: true }))).toBe(true);
    expect(jumpPrompt).not.toHaveBeenCalled();
  });
});
