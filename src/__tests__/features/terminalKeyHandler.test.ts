import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TerminalKeyHandlerDeps } from "../../features/terminal/hooks/terminalKeyHandler";
import { createTerminalKeyEventHandler } from "../../features/terminal/hooks/terminalKeyHandler";

// Pre-mocked for Task 4/5 Windows-clipboard branches; current handler doesn't read platform.
// Note: Windows/macOS/Linux suites override this default via vi.doMock + vi.resetModules
// inside their beforeEach to swap platform flags at test time.
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
  const writeText = vi.fn().mockResolvedValue(undefined);
  const readText = vi.fn().mockResolvedValue("");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("intercepts Ctrl+ArrowUp and calls jumpPrompt('prev')", () => {
    const handler = createTerminalKeyEventHandler({
      sid: "s1",
      term: term as TerminalKeyHandlerDeps["term"],
      pty: pty as TerminalKeyHandlerDeps["pty"],
      jumpPrompt,
      writeText,
      readText,
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
      writeText,
      readText,
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
      writeText,
      readText,
    });
    expect(handler(makeEvent({ key: "a" }))).toBe(true);
    expect(handler(makeEvent({ key: "Enter" }))).toBe(true);
    expect(handler(makeEvent({ key: "c", ctrlKey: true }))).toBe(true);
    expect(jumpPrompt).not.toHaveBeenCalled();
  });

  it("blocks clean Cmd/Ctrl+T from reaching the PTY without stopping propagation", () => {
    const handler = createTerminalKeyEventHandler({
      sid: "s1",
      term: term as TerminalKeyHandlerDeps["term"],
      pty: pty as TerminalKeyHandlerDeps["pty"],
      jumpPrompt,
      writeText,
      readText,
    });

    for (const e of [
      makeEvent({ key: "t", ctrlKey: true }),
      makeEvent({ key: "T", metaKey: true }),
    ]) {
      expect(handler(e)).toBe(false);
      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(e.stopPropagation).not.toHaveBeenCalled();
    }
  });

  it("lets modified Cmd/Ctrl+T combinations pass through", () => {
    const handler = createTerminalKeyEventHandler({
      sid: "s1",
      term: term as TerminalKeyHandlerDeps["term"],
      pty: pty as TerminalKeyHandlerDeps["pty"],
      jumpPrompt,
      writeText,
      readText,
    });

    expect(handler(makeEvent({ key: "t", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(handler(makeEvent({ key: "t", metaKey: true, altKey: true }))).toBe(true);
  });
});

describe("createTerminalKeyEventHandler — Windows Ctrl+C copy", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.doMock("../../lib/platform", () => ({
      isWindows: true,
      isMac: false,
      isLinux: false,
    }));
  });

  it("copies the selection and blocks \\x03 when selection is non-empty", async () => {
    const { createTerminalKeyEventHandler: factory } = await import(
      "../../features/terminal/hooks/terminalKeyHandler"
    );
    const term = {
      hasSelection: vi.fn(() => true),
      getSelection: vi.fn(() => "hello"),
      clearSelection: vi.fn(),
    };
    const pty = { write: vi.fn() };
    const writeText = vi.fn().mockResolvedValue(undefined);
    const readText = vi.fn().mockResolvedValue("");
    const handler = factory({
      sid: "s1",
      term: term as TerminalKeyHandlerDeps["term"],
      pty: pty as TerminalKeyHandlerDeps["pty"],
      jumpPrompt: vi.fn(),
      writeText,
      readText,
    });

    const result = handler(makeEvent({ key: "c", ctrlKey: true }));

    expect(writeText).toHaveBeenCalledWith("hello");
    expect(term.clearSelection).toHaveBeenCalled();
    expect(pty.write).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it("lets Ctrl+C through to xterm (SIGINT path) when no selection", async () => {
    const { createTerminalKeyEventHandler: factory } = await import(
      "../../features/terminal/hooks/terminalKeyHandler"
    );
    const term = {
      hasSelection: vi.fn(() => false),
      getSelection: vi.fn(() => ""),
      clearSelection: vi.fn(),
    };
    const pty = { write: vi.fn() };
    const writeText = vi.fn().mockResolvedValue(undefined);
    const readText = vi.fn().mockResolvedValue("");
    const handler = factory({
      sid: "s1",
      term: term as TerminalKeyHandlerDeps["term"],
      pty: pty as TerminalKeyHandlerDeps["pty"],
      jumpPrompt: vi.fn(),
      writeText,
      readText,
    });

    const result = handler(makeEvent({ key: "c", ctrlKey: true }));

    expect(writeText).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("ignores Ctrl+Shift+C / Ctrl+Alt+C / Ctrl+Meta+C (let xterm handle)", async () => {
    const { createTerminalKeyEventHandler: factory } = await import(
      "../../features/terminal/hooks/terminalKeyHandler"
    );
    const term = {
      hasSelection: vi.fn(() => true),
      getSelection: vi.fn(() => "hello"),
      clearSelection: vi.fn(),
    };
    const writeText = vi.fn().mockResolvedValue(undefined);
    const handler = factory({
      sid: "s1",
      term: term as TerminalKeyHandlerDeps["term"],
      pty: { write: vi.fn() } as TerminalKeyHandlerDeps["pty"],
      jumpPrompt: vi.fn(),
      writeText,
      readText: vi.fn().mockResolvedValue(""),
    });
    expect(handler(makeEvent({ key: "c", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(handler(makeEvent({ key: "c", ctrlKey: true, altKey: true }))).toBe(true);
    expect(handler(makeEvent({ key: "c", ctrlKey: true, metaKey: true }))).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("createTerminalKeyEventHandler — Windows Ctrl+V paste", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.doMock("../../lib/platform", () => ({
      isWindows: true,
      isMac: false,
      isLinux: false,
    }));
  });

  it("reports a rejected Windows paste to the terminal warning", async () => {
    const { createTerminalKeyEventHandler: factory } = await import("../../features/terminal/hooks/terminalKeyHandler");
    const onInputError = vi.fn();
    const handler = factory({
      sid: "s1", term: { hasSelection: () => false, getSelection: () => "", clearSelection: vi.fn() },
      pty: { write: vi.fn().mockRejectedValue(new Error("queue full")) }, jumpPrompt: vi.fn(),
      readText: vi.fn().mockResolvedValue("paste"), writeText: vi.fn(), onInputError,
    });
    expect(handler(makeEvent({ key: "v", ctrlKey: true }))).toBe(false);
    await vi.waitFor(() => expect(onInputError).toHaveBeenCalledOnce());
  });

  it("reads clipboard and writes to PTY on Ctrl+V", async () => {
    const { createTerminalKeyEventHandler: factory } = await import(
      "../../features/terminal/hooks/terminalKeyHandler"
    );
    const pty = { write: vi.fn().mockResolvedValue(undefined) };
    const readText = vi.fn().mockResolvedValue("pasted text");
    const writeText = vi.fn().mockResolvedValue(undefined);
    const handler = factory({
      sid: "sid-123",
      term: {
        hasSelection: vi.fn(() => false),
        getSelection: vi.fn(() => ""),
        clearSelection: vi.fn(),
      } as TerminalKeyHandlerDeps["term"],
      pty: pty as TerminalKeyHandlerDeps["pty"],
      jumpPrompt: vi.fn(),
      writeText,
      readText,
    });

    const result = handler(makeEvent({ key: "v", ctrlKey: true }));

    expect(result).toBe(false);
    await vi.waitFor(() => expect(readText).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(pty.write).toHaveBeenCalledWith("sid-123", "pasted text"),
    );
  });

  it("does not call pty.write when clipboard is empty/null", async () => {
    const { createTerminalKeyEventHandler: factory } = await import(
      "../../features/terminal/hooks/terminalKeyHandler"
    );
    const pty = { write: vi.fn() };
    const readText = vi.fn().mockResolvedValue(null);
    const handler = factory({
      sid: "sid-123",
      term: {
        hasSelection: vi.fn(() => false),
        getSelection: vi.fn(() => ""),
        clearSelection: vi.fn(),
      } as TerminalKeyHandlerDeps["term"],
      pty: pty as TerminalKeyHandlerDeps["pty"],
      jumpPrompt: vi.fn(),
      writeText: vi.fn().mockResolvedValue(undefined),
      readText,
    });

    const result = handler(makeEvent({ key: "v", ctrlKey: true }));

    expect(result).toBe(false);
    await vi.waitFor(() => expect(readText).toHaveBeenCalled());
    expect(pty.write).not.toHaveBeenCalled();
  });

  it("ignores Ctrl+Shift+V / Ctrl+Alt+V (let xterm handle)", async () => {
    const { createTerminalKeyEventHandler: factory } = await import(
      "../../features/terminal/hooks/terminalKeyHandler"
    );
    const readText = vi.fn().mockResolvedValue("nope");
    const handler = factory({
      sid: "sid-123",
      term: {
        hasSelection: vi.fn(() => false),
        getSelection: vi.fn(() => ""),
        clearSelection: vi.fn(),
      } as TerminalKeyHandlerDeps["term"],
      pty: { write: vi.fn() } as TerminalKeyHandlerDeps["pty"],
      jumpPrompt: vi.fn(),
      writeText: vi.fn().mockResolvedValue(undefined),
      readText,
    });
    expect(handler(makeEvent({ key: "v", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(handler(makeEvent({ key: "v", ctrlKey: true, altKey: true }))).toBe(true);
    expect(readText).not.toHaveBeenCalled();
  });
});

describe("createTerminalKeyEventHandler — macOS regression", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.doMock("../../lib/platform", () => ({
      isWindows: false,
      isMac: true,
      isLinux: false,
    }));
  });

  it("does not intercept Ctrl+C with selection on macOS (xterm keeps emitting \\x03)", async () => {
    const { createTerminalKeyEventHandler: factory } = await import(
      "../../features/terminal/hooks/terminalKeyHandler"
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    const handler = factory({
      sid: "s1",
      term: {
        hasSelection: vi.fn(() => true),
        getSelection: vi.fn(() => "hello"),
        clearSelection: vi.fn(),
      } as TerminalKeyHandlerDeps["term"],
      pty: { write: vi.fn() } as TerminalKeyHandlerDeps["pty"],
      jumpPrompt: vi.fn(),
      writeText,
      readText: vi.fn().mockResolvedValue(""),
    });
    expect(handler(makeEvent({ key: "c", ctrlKey: true }))).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("preserves Claude Control shortcuts and reserves only clean Cmd actions on macOS", async () => {
    const { createTerminalKeyEventHandler: factory } = await import("../../features/terminal/hooks/terminalKeyHandler");
    const jumpPrompt = vi.fn();
    const handler = factory({
      sid: "s1", term: { hasSelection: () => false, getSelection: () => "", clearSelection: vi.fn() },
      pty: { write: vi.fn() }, jumpPrompt, writeText: vi.fn(), readText: vi.fn(),
    });
    for (const key of ["n", "t", "w", "f", ",", "ArrowUp", "ArrowDown"]) {
      const event = makeEvent({ key, ctrlKey: true });
      expect(handler(event)).toBe(true);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(jumpPrompt).not.toHaveBeenCalled();
    for (const key of ["n", "t", "w", "f", ",", "+", "-"]) {
      const event = makeEvent({ key, metaKey: true });
      expect(handler(event)).toBe(false);
      // Bubble to Orbit; the window handler alone prevents browser defaults.
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopPropagation).not.toHaveBeenCalled();
    }
    expect(handler(makeEvent({ key: "ArrowUp", metaKey: true, altKey: true }))).toBe(true);
  });

  it("does not intercept Ctrl+V on macOS", async () => {
    const { createTerminalKeyEventHandler: factory } = await import(
      "../../features/terminal/hooks/terminalKeyHandler"
    );
    const readText = vi.fn().mockResolvedValue("x");
    const pty = { write: vi.fn() };
    const handler = factory({
      sid: "s1",
      term: {
        hasSelection: vi.fn(() => false),
        getSelection: vi.fn(() => ""),
        clearSelection: vi.fn(),
      } as TerminalKeyHandlerDeps["term"],
      pty: pty as TerminalKeyHandlerDeps["pty"],
      jumpPrompt: vi.fn(),
      writeText: vi.fn().mockResolvedValue(undefined),
      readText,
    });
    expect(handler(makeEvent({ key: "v", ctrlKey: true }))).toBe(true);
    expect(readText).not.toHaveBeenCalled();
    expect(pty.write).not.toHaveBeenCalled();
  });
});

describe("createTerminalKeyEventHandler — Linux regression", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.doMock("../../lib/platform", () => ({
      isWindows: false,
      isMac: false,
      isLinux: true,
    }));
  });

  it("does not intercept Ctrl+C with selection on Linux", async () => {
    const { createTerminalKeyEventHandler: factory } = await import(
      "../../features/terminal/hooks/terminalKeyHandler"
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    const handler = factory({
      sid: "s1",
      term: {
        hasSelection: vi.fn(() => true),
        getSelection: vi.fn(() => "hello"),
        clearSelection: vi.fn(),
      } as TerminalKeyHandlerDeps["term"],
      pty: { write: vi.fn() } as TerminalKeyHandlerDeps["pty"],
      jumpPrompt: vi.fn(),
      writeText,
      readText: vi.fn().mockResolvedValue(""),
    });
    expect(handler(makeEvent({ key: "c", ctrlKey: true }))).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
  });
});
