import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, act } from "@testing-library/react";
import { createElement } from "react";

// ---------------------------------------------------------------------------
// Polyfill ResizeObserver for jsdom
// ---------------------------------------------------------------------------
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal("ResizeObserver", MockResizeObserver);

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the component under test
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn().mockImplementation((cmd: string) => {
  if (cmd === "load_scrollback") return Promise.resolve(null);
  return Promise.resolve(undefined);
});
const mockUnlisten = vi.fn();
const mockListen = vi.fn().mockResolvedValue(mockUnlisten);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

// xterm.js mocks
const mockTermWrite = vi.fn();
const mockTermOpen = vi.fn();
const mockTermDispose = vi.fn();
const mockTermLoadAddon = vi.fn();
const mockTermOnData = vi.fn();
const mockTermFocus = vi.fn();
const mockTermOptions: Record<string, unknown> = {};

vi.mock("@xterm/xterm", () => {
  class MockTerminal {
    options = mockTermOptions;
    open = mockTermOpen;
    write = mockTermWrite;
    dispose = mockTermDispose;
    loadAddon = mockTermLoadAddon;
    onData = mockTermOnData;
    focus = mockTermFocus;
    registerLinkProvider = vi.fn();
    buffer = { active: { getLine: vi.fn() } };
  }
  return { Terminal: MockTerminal };
});

const mockFit = vi.fn();
const mockProposeDimensions = vi.fn().mockReturnValue({ cols: 120, rows: 40 });

vi.mock("@xterm/addon-fit", () => {
  class MockFitAddon {
    fit = mockFit;
    proposeDimensions = mockProposeDimensions;
  }
  return { FitAddon: MockFitAddon };
});

vi.mock("@xterm/addon-search", () => {
  class MockSearchAddon {
    clearDecorations = vi.fn();
    findNext = vi.fn();
    findPrevious = vi.fn();
  }
  return { SearchAddon: MockSearchAddon };
});

vi.mock("@xterm/addon-serialize", () => {
  class MockSerializeAddon {
    serialize = vi.fn().mockReturnValue("");
  }
  return { SerializeAddon: MockSerializeAddon };
});

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// Mock i18n — return key with interpolated params
vi.mock("../../i18n/i18n", () => ({
  useT: () => (key: string, params?: Record<string, string | number>) => {
    let result = key;
    if (params) {
      for (const [, v] of Object.entries(params)) {
        result += ` ${v}`;
      }
    }
    return result;
  },
}));

// Mock the store
vi.mock("../../core/store", () => {
  const defaultState = {
    settings: {
      theme: "orbit" as const,
      fontSize: 11,
      sidebarWidth: 200,
      terminal: "iterm2" as const,
      editor: "vscode" as const,
      analytics: true,
      statuslineAsked: false,
      autoUpdate: true,
      defaultMode: "normal" as const,
      language: "fr" as const,
    },
    activeSid: "sess-1",
    projects: [],
    renameSession: vi.fn(),
    updateSessionCost: vi.fn(),
    setClaudeSessionId: vi.fn(),
    setDangerousMode: vi.fn(),
  };

  const store = Object.assign(
    function useStore(selector?: (s: typeof defaultState) => unknown) {
      return selector ? selector(defaultState) : defaultState;
    },
    {
      getState: vi.fn().mockReturnValue(defaultState),
      setState: vi.fn(),
      subscribe: vi.fn().mockReturnValue(vi.fn()),
    },
  );
  return {
    useStore: store,
  };
});

import TerminalView from "../../features/terminal/Terminal";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function flushAsync() {
  for (let i = 0; i < 30; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function renderTerminal(overrides: Partial<Parameters<typeof TerminalView>[0]> = {}) {
  const props = {
    sessionId: "sess-1",
    projectDir: "/home/user/project",
    active: true,
    searchOpen: false,
    onSearchClose: vi.fn(),
    ...overrides,
  };
  return render(createElement(TerminalView, props));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TerminalView integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockTermOptions)) delete mockTermOptions[key];
  });

  afterEach(() => {
    cleanup();
  });

  describe("PTY spawn", () => {
    it("calls spawn_pty with correct params from proposeDimensions", async () => {
      renderTerminal();
      await flushAsync();

      expect(mockInvoke).toHaveBeenCalledWith("spawn_pty", {
        sessionId: "sess-1",
        projectDir: "/home/user/project",
        cols: 120,
        rows: 40,
        claudeSessionId: expect.any(String),
        resumeMode: false,
        sessionName: null,
        dangerousMode: false,
      });
    });

    it("falls back to 80x24 when proposeDimensions returns null", async () => {
      mockProposeDimensions.mockReturnValueOnce(null);
      renderTerminal();
      await flushAsync();

      expect(mockInvoke).toHaveBeenCalledWith("spawn_pty", {
        sessionId: "sess-1",
        projectDir: "/home/user/project",
        cols: 80,
        rows: 24,
        claudeSessionId: expect.any(String),
        resumeMode: false,
        sessionName: null,
        dangerousMode: false,
      });
    });
  });

  describe("cleanup on unmount", () => {
    it("saves scrollback and disposes on unmount", async () => {
      const { unmount } = renderTerminal();
      await flushAsync();

      mockInvoke.mockClear();
      unmount();
      await flushAsync();
      // Give async imports time to resolve
      await new Promise((r) => setTimeout(r, 100));
      await flushAsync();

      const calls = mockInvoke.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls).toContain("save_scrollback");
    });

    it("disposes the xterm terminal instance", async () => {
      const { unmount } = renderTerminal();
      await flushAsync();

      unmount();
      expect(mockTermDispose).toHaveBeenCalled();
    });
  });

  describe("event listener lifecycle", () => {
    it("registers a pty-output listener after spawn", async () => {
      renderTerminal();
      await flushAsync();

      expect(mockListen).toHaveBeenCalledWith("pty-output", expect.any(Function));
    });

    it("calls unlisten on unmount", async () => {
      const { unmount } = renderTerminal();
      await flushAsync();

      unmount();
      expect(mockUnlisten).toHaveBeenCalled();
    });
  });

  describe("terminal input forwarding", () => {
    it("forwards all input to PTY for native Claude Code autocomplete", async () => {
      renderTerminal();
      await flushAsync();

      expect(mockTermOnData).toHaveBeenCalled();
      const onDataCallback = mockTermOnData.mock.calls[0][0];

      mockInvoke.mockClear();
      onDataCallback("hello");
      await flushAsync();

      expect(mockInvoke).toHaveBeenCalledWith("write_pty", {
        sessionId: "sess-1",
        data: "hello",
      });
    });

    it("forwards control sequences (Ctrl+C) to PTY", async () => {
      renderTerminal();
      await flushAsync();

      expect(mockTermOnData).toHaveBeenCalled();
      const onDataCallback = mockTermOnData.mock.calls[0][0];

      mockInvoke.mockClear();
      onDataCallback("\x03"); // Ctrl+C
      await flushAsync();

      expect(mockInvoke).toHaveBeenCalledWith("write_pty", {
        sessionId: "sess-1",
        data: "\x03",
      });
    });

    it("forwards escape sequences (arrow keys) to PTY", async () => {
      renderTerminal();
      await flushAsync();

      expect(mockTermOnData).toHaveBeenCalled();
      const onDataCallback = mockTermOnData.mock.calls[0][0];

      mockInvoke.mockClear();
      onDataCallback("\x1b[A"); // Arrow Up
      await flushAsync();

      expect(mockInvoke).toHaveBeenCalledWith("write_pty", {
        sessionId: "sess-1",
        data: "\x1b[A",
      });
    });
  });

  describe("addon setup", () => {
    it("loads FitAddon and SearchAddon into the terminal", async () => {
      renderTerminal();
      await flushAsync();

      expect(mockTermLoadAddon).toHaveBeenCalledTimes(3);
    });

    it("opens the terminal in the container element", async () => {
      renderTerminal();
      await flushAsync();

      expect(mockTermOpen).toHaveBeenCalledWith(expect.any(HTMLDivElement));
    });
  });

  describe("initialization", () => {
    it("calls fit() on init", async () => {
      renderTerminal();
      await flushAsync();

      expect(mockFit).toHaveBeenCalled();
    });

    it("shows error message when spawn_pty fails", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "load_scrollback") return Promise.resolve(null);
        if (cmd === "spawn_pty") return Promise.reject(new Error("Claude not found"));
        return Promise.resolve(undefined);
      });
      renderTerminal();
      await flushAsync();

      expect(mockTermWrite).toHaveBeenCalledWith(
        expect.stringContaining("Claude not found")
      );

      // Restore default mock
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "load_scrollback") return Promise.resolve(null);
        return Promise.resolve(undefined);
      });
    });
  });
});
