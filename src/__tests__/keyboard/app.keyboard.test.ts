import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock Tauri FS before importing store
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn().mockRejectedValue(new Error("no fs")),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  BaseDirectory: { Home: 1 },
}));

// Mock Tauri core
const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Mock analytics
vi.mock("../../lib/analytics", () => ({
  initAnalytics: vi.fn(),
  trackEvent: vi.fn(),
  setAnalyticsEnabled: vi.fn(),
}));

// Mock themes (applyChrome touches DOM/CSS)
vi.mock("../../lib/themes", () => ({
  THEMES: {
    orbit: { label: "Orbit" },
    dracula: { label: "Dracula" },
  },
  applyChrome: vi.fn(),
}));

// Mock Terminal component
vi.mock("../../features/Terminal", () => ({
  default: () => null,
}));

import { useStore } from "../../core/store";
import { handleKeyboardShortcut, type KeyboardCallbacks } from "../../keyboard/keyboardHandler";

// --- Helpers ---

function getState() {
  return useStore.getState();
}

/** Set up a project with N sessions and mark store as loaded. */
function seedProject(sessionCount = 3) {
  getState().addProject("test-project", "/tmp/test");
  for (let i = 1; i < sessionCount; i++) {
    getState().addSession(`session-${i + 1}`);
  }
  // Re-select the first session so tests start in a known state
  const proj = getState().projects[0];
  getState().setActiveSession(proj.sessions[0].id);
  useStore.setState({ loaded: true });
}

function fire(key: string, opts: Partial<KeyboardEvent> = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
  window.dispatchEvent(event);
}

/** Create callbacks that dispatch test events */
function createTestCallbacks(): KeyboardCallbacks {
  return {
    showNewProject: () => window.dispatchEvent(new CustomEvent("test:showNewProject")),
    confirmDeleteSession: (sid) => window.dispatchEvent(new CustomEvent("test:confirmDeleteSession", { detail: sid })),
    toggleSearch: () => window.dispatchEvent(new CustomEvent("test:toggleSearch")),
    showPreferences: () => window.dispatchEvent(new CustomEvent("test:showPreferences")),
  };
}

/**
 * Install the keyboard handler using the shared module.
 */
function installKeyboardHandler() {
  const callbacks = createTestCallbacks();
  const handler = (e: KeyboardEvent) => handleKeyboardShortcut(e, callbacks);
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}

// --- Tests ---

describe("App keyboard shortcuts", () => {
  let cleanup: () => void;

  beforeEach(() => {
    // Reset store
    useStore.setState({
      projects: [],
      activePid: "",
      activeSid: "",
      settings: {
        terminal: "iterm2",
        editor: "vscode",
        theme: "orbit",
        fontSize: 11,
        sidebarWidth: 200,
        analytics: true,
        statuslineAsked: false,
        autoUpdate: true, autoNotifications: true,
        defaultMode: "normal" as const,
        language: "fr" as const,
      },
      loaded: false,
      projectSessions: {},
      splitLayout: { type: "none", primarySid: "", ratio: 0.5 },
      focusedPane: "primary" as const,
    });
    mockInvoke.mockClear();
    seedProject(3);
    cleanup = installKeyboardHandler();
  });

  afterEach(() => {
    cleanup();
  });

  // --- Cmd+Shift+N: new project modal ---

  describe("Cmd+Shift+N", () => {
    it("should trigger new project modal", () => {
      const spy = vi.fn();
      window.addEventListener("test:showNewProject", spy);
      fire("n", { metaKey: true, shiftKey: true });
      expect(spy).toHaveBeenCalledTimes(1);
      window.removeEventListener("test:showNewProject", spy);
    });
  });

  // --- Cmd+N: add session ---

  describe("Cmd+N", () => {
    it("should add a new session to the active project", () => {
      const before = getState().projects[0].sessions.length;
      fire("n", { metaKey: true });
      const after = getState().projects[0].sessions.length;
      expect(after).toBe(before + 1);
    });

    it("should switch to the newly created session", () => {
      fire("n", { metaKey: true });
      const proj = getState().projects[0];
      const lastSession = proj.sessions[proj.sessions.length - 1];
      expect(getState().activeSid).toBe(lastSession.id);
    });
  });

  // --- Cmd+W: confirm delete session ---

  describe("Cmd+W", () => {
    it("should trigger confirm delete dialog when more than one session", () => {
      const spy = vi.fn();
      window.addEventListener("test:confirmDeleteSession", spy);
      fire("w", { metaKey: true });
      expect(spy).toHaveBeenCalledTimes(1);
      window.removeEventListener("test:confirmDeleteSession", spy);
    });

    it("should pass the active session id to the confirm dialog", () => {
      const spy = vi.fn();
      window.addEventListener("test:confirmDeleteSession", spy);
      const activeSid = getState().activeSid;
      fire("w", { metaKey: true });
      expect((spy.mock.calls[0][0] as CustomEvent).detail).toBe(activeSid);
      window.removeEventListener("test:confirmDeleteSession", spy);
    });

    it("should not trigger when only one session exists", () => {
      // Remove sessions until only one remains
      const proj = getState().projects[0];
      for (let i = proj.sessions.length - 1; i > 0; i--) {
        getState().removeSession(proj.sessions[i].id);
      }
      const spy = vi.fn();
      window.addEventListener("test:confirmDeleteSession", spy);
      fire("w", { metaKey: true });
      expect(spy).not.toHaveBeenCalled();
      window.removeEventListener("test:confirmDeleteSession", spy);
    });
  });

  // --- Cmd+F: toggle search ---

  describe("Cmd+F", () => {
    it("should dispatch toggle search event", () => {
      const spy = vi.fn();
      window.addEventListener("test:toggleSearch", spy);
      fire("f", { metaKey: true });
      expect(spy).toHaveBeenCalledTimes(1);
      window.removeEventListener("test:toggleSearch", spy);
    });
  });

  // --- Cmd+,: open preferences ---

  describe("Cmd+,", () => {
    it("should trigger preferences modal", () => {
      const spy = vi.fn();
      window.addEventListener("test:showPreferences", spy);
      fire(",", { metaKey: true });
      expect(spy).toHaveBeenCalledTimes(1);
      window.removeEventListener("test:showPreferences", spy);
    });
  });

  // --- Cmd+= / Cmd+-: font size ---

  describe("Cmd+= (increase font size)", () => {
    it("should increase font size by 1", () => {
      const before = getState().settings.fontSize;
      fire("=", { metaKey: true });
      expect(getState().settings.fontSize).toBe(before + 1);
    });

    it("should not exceed max font size of 20", () => {
      getState().setFontSize(20);
      fire("=", { metaKey: true });
      expect(getState().settings.fontSize).toBe(20);
    });

    it("should also work with + key", () => {
      const before = getState().settings.fontSize;
      fire("+", { metaKey: true });
      expect(getState().settings.fontSize).toBe(before + 1);
    });
  });

  describe("Cmd+- (decrease font size)", () => {
    it("should decrease font size by 1", () => {
      const before = getState().settings.fontSize;
      fire("-", { metaKey: true });
      expect(getState().settings.fontSize).toBe(before - 1);
    });

    it("should not go below min font size of 8", () => {
      getState().setFontSize(8);
      fire("-", { metaKey: true });
      expect(getState().settings.fontSize).toBe(8);
    });
  });

  // --- Cmd+\\: toggle split ---

  describe("Cmd+\\", () => {
    it("should create split when not in split mode", () => {
      fire("\\", { metaKey: true });
      expect(getState().splitLayout.type).not.toBe("none");
    });

    it("should unsplit when in split mode", () => {
      // First create a split
      fire("\\", { metaKey: true });
      expect(getState().splitLayout.type).not.toBe("none");
      // Then unsplit
      fire("\\", { metaKey: true });
      expect(getState().splitLayout.type).toBe("none");
    });
  });

  // --- Cmd+] / Cmd+[: focus pane ---

  describe("Cmd+] / Cmd+[", () => {
    it("should toggle focused pane with Cmd+]", () => {
      fire("\\", { metaKey: true }); // create split first
      const before = getState().focusedPane;
      fire("]", { metaKey: true });
      expect(getState().focusedPane).not.toBe(before);
    });

    it("should toggle focused pane with Cmd+[", () => {
      fire("\\", { metaKey: true }); // create split first
      const before = getState().focusedPane;
      fire("[", { metaKey: true });
      expect(getState().focusedPane).not.toBe(before);
    });

    it("should do nothing when not in split mode", () => {
      const before = getState().focusedPane;
      fire("]", { metaKey: true });
      expect(getState().focusedPane).toBe(before);
    });
  });

  // --- Ctrl+1-9: switch session by index ---

  describe("Ctrl+1-9", () => {
    it("should switch to session at index 0 on Ctrl+1", () => {
      const proj = getState().projects[0];
      // Start on session 1 (index 1)
      getState().setActiveSession(proj.sessions[1].id);
      fire("1", { ctrlKey: true });
      expect(getState().activeSid).toBe(proj.sessions[0].id);
    });

    it("should switch to session at index 1 on Ctrl+2", () => {
      const proj = getState().projects[0];
      fire("2", { ctrlKey: true });
      expect(getState().activeSid).toBe(proj.sessions[1].id);
    });

    it("should switch to session at index 2 on Ctrl+3", () => {
      const proj = getState().projects[0];
      fire("3", { ctrlKey: true });
      expect(getState().activeSid).toBe(proj.sessions[2].id);
    });

    it("should do nothing when index exceeds session count", () => {
      const before = getState().activeSid;
      fire("9", { ctrlKey: true });
      expect(getState().activeSid).toBe(before);
    });
  });

  // --- Ctrl+Tab / Ctrl+Shift+Tab: cycle sessions ---

  describe("Ctrl+Tab (next session)", () => {
    it("should cycle to the next session", () => {
      const proj = getState().projects[0];
      // Start on session 0
      expect(getState().activeSid).toBe(proj.sessions[0].id);
      fire("Tab", { ctrlKey: true });
      expect(getState().activeSid).toBe(proj.sessions[1].id);
    });

    it("should wrap around to the first session", () => {
      const proj = getState().projects[0];
      // Go to last session
      getState().setActiveSession(proj.sessions[2].id);
      fire("Tab", { ctrlKey: true });
      expect(getState().activeSid).toBe(proj.sessions[0].id);
    });
  });

  describe("Ctrl+Shift+Tab (previous session)", () => {
    it("should cycle to the previous session", () => {
      const proj = getState().projects[0];
      getState().setActiveSession(proj.sessions[1].id);
      fire("Tab", { ctrlKey: true, shiftKey: true });
      expect(getState().activeSid).toBe(proj.sessions[0].id);
    });

    it("should wrap around to the last session", () => {
      const proj = getState().projects[0];
      // Start on session 0
      expect(getState().activeSid).toBe(proj.sessions[0].id);
      fire("Tab", { ctrlKey: true, shiftKey: true });
      expect(getState().activeSid).toBe(proj.sessions[2].id);
    });
  });
});
