import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Tauri event API before importing store
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// Mock Tauri core API
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

// Mock Tauri FS before importing store
const mockReadTextFile = vi.fn().mockRejectedValue(new Error("no fs"));
const mockRemove = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  remove: (...args: unknown[]) => mockRemove(...args),
  BaseDirectory: { Home: 1 },
}));

import { useStore } from "../../core/store";

function getState() {
  return useStore.getState();
}

describe("store", () => {
  beforeEach(() => {
    // Reset store to initial state
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
        autoUpdate: true,
        defaultMode: "normal" as const,
        language: "fr" as const,
      },
      loaded: false,
      sessionCosts: {},
      splitLayout: { type: "none", primarySid: "", ratio: 0.5 },
      focusedPane: "primary" as const,
    });
  });

  describe("init", () => {
    it("sets loaded to true even without data", async () => {
      await getState().init();
      expect(getState().loaded).toBe(true);
    });

    it("keeps empty projects when no persisted data", async () => {
      await getState().init();
      expect(getState().projects).toEqual([]);
    });
  });

  describe("addProject", () => {
    it("adds a project and switches to it", () => {
      getState().addProject("test", "/tmp/test");
      const s = getState();
      expect(s.projects).toHaveLength(1);
      expect(s.projects[0].name).toBe("test");
      expect(s.projects[0].dir).toBe("/tmp/test");
      expect(s.activePid).toBe(s.projects[0].id);
      expect(s.activeSid).toBe(s.projects[0].sessions[0].id);
    });

    it("creates a default 'main' session", () => {
      getState().addProject("p", "/tmp/p");
      const proj = getState().projects[0];
      expect(proj.sessions).toHaveLength(1);
      expect(proj.sessions[0].name).toBe("main");
    });
  });

  describe("removeProject", () => {
    it("switches to next project when active is removed", () => {
      getState().addProject("a", "/a");
      getState().addProject("b", "/b");
      const pidA = getState().projects[0].id;
      // Switch to A then remove it
      getState().setActiveProject(pidA);
      getState().removeProject(pidA);
      const s = getState();
      expect(s.projects).toHaveLength(1);
      expect(s.projects[0].name).toBe("b");
      expect(s.activePid).toBe(s.projects[0].id);
    });

    it("does not remove the last project", () => {
      getState().addProject("only", "/only");
      const pid = getState().projects[0].id;
      getState().removeProject(pid);
      expect(getState().projects).toHaveLength(1);
    });
  });

  describe("addSession", () => {
    it("adds a session to the active project and switches to it", () => {
      getState().addProject("p", "/p");
      getState().addSession("second");
      const proj = getState().projects[0];
      expect(proj.sessions).toHaveLength(2);
      expect(proj.sessions[1].name).toBe("second");
      expect(getState().activeSid).toBe(proj.sessions[1].id);
    });

    it("auto-names session when no name provided", () => {
      getState().addProject("p", "/p");
      getState().addSession();
      const proj = getState().projects[0];
      expect(proj.sessions[1].name).toBe("session-2");
    });
  });

  describe("removeSession", () => {
    it("switches to previous session (not [0]) when removing active", () => {
      getState().addProject("p", "/p");
      getState().addSession("s2");
      getState().addSession("s3");
      const proj = getState().projects[0];
      const s3id = proj.sessions[2].id;
      const s2id = proj.sessions[1].id;
      // Active is s3 (last added)
      expect(getState().activeSid).toBe(s3id);
      getState().removeSession(s3id);
      // Should switch to s2 (previous), not main ([0])
      expect(getState().activeSid).toBe(s2id);
    });

    it("does not remove the last session", () => {
      getState().addProject("p", "/p");
      const sid = getState().projects[0].sessions[0].id;
      getState().removeSession(sid);
      expect(getState().projects[0].sessions).toHaveLength(1);
    });
  });

  describe("reorderSession", () => {
    it("moves session to target position", () => {
      getState().addProject("p", "/p");
      getState().addSession("s2");
      getState().addSession("s3");
      const proj = getState().projects[0];
      const [s1, s2, s3] = proj.sessions;
      // Move s3 to s1's position
      getState().reorderSession(s3.id, s1.id);
      const reordered = getState().projects[0].sessions;
      expect(reordered[0].id).toBe(s3.id);
      expect(reordered[1].id).toBe(s1.id);
      expect(reordered[2].id).toBe(s2.id);
    });
  });

  describe("renameSession", () => {
    it("renames a session", () => {
      getState().addProject("p", "/p");
      const sid = getState().projects[0].sessions[0].id;
      getState().renameSession(sid, "renamed");
      expect(getState().projects[0].sessions[0].name).toBe("renamed");
    });
  });

  describe("renameProject", () => {
    it("renames a project", () => {
      getState().addProject("old", "/old");
      const pid = getState().projects[0].id;
      getState().renameProject(pid, "new");
      expect(getState().projects[0].name).toBe("new");
    });
  });

  describe("settings", () => {
    it("setTheme updates theme", () => {
      getState().setTheme("dracula");
      expect(getState().settings.theme).toBe("dracula");
    });

    it("setFontSize updates fontSize", () => {
      getState().setFontSize(14);
      expect(getState().settings.fontSize).toBe(14);
    });

    it("setAnalytics updates analytics", () => {
      getState().setAnalytics(false);
      expect(getState().settings.analytics).toBe(false);
    });

    it("setSidebarWidth updates sidebarWidth", () => {
      getState().setSidebarWidth(300);
      expect(getState().settings.sidebarWidth).toBe(300);
    });

    it("setTerminal updates terminal", () => {
      getState().setTerminal("ghostty");
      expect(getState().settings.terminal).toBe("ghostty");
    });

    it("setStatuslineAsked sets to true", () => {
      getState().setStatuslineAsked();
      expect(getState().settings.statuslineAsked).toBe(true);
    });
  });


  describe("session metadata", () => {
    it("updateSessionCost stores cost for session", () => {
      getState().addProject("p", "/p");
      const sid = getState().projects[0].sessions[0].id;
      getState().updateSessionCost(sid, 1.23);
      expect(getState().sessionCosts[sid]).toBe(1.23);
    });

    it("setClaudeSessionId stores claude ID on session", () => {
      getState().addProject("p", "/p");
      const sid = getState().projects[0].sessions[0].id;
      getState().setClaudeSessionId(sid, "claude-abc-123");
      const session = getState().projects[0].sessions[0];
      expect(session.claudeSessionId).toBe("claude-abc-123");
    });

    it("setDangerousMode sets dangerous mode flag", () => {
      getState().addProject("p", "/p");
      const sid = getState().projects[0].sessions[0].id;
      getState().setDangerousMode(sid, true);
      expect(getState().projects[0].sessions[0].dangerousMode).toBe(true);
      getState().setDangerousMode(sid, false);
      expect(getState().projects[0].sessions[0].dangerousMode).toBe(false);
    });
  });

  describe("bookmarks", () => {
    function getProjectBookmarks() {
      const s = getState();
      const proj = s.projects.find((p) => p.id === s.activePid);
      return proj?.bookmarks ?? [];
    }

    it("addBookmark adds to active project with id", () => {
      getState().addProject("p", "/p");
      getState().addBookmark("fix tests", "run npm test and fix failures");
      const bookmarks = getProjectBookmarks();
      expect(bookmarks).toHaveLength(1);
      expect(bookmarks[0].name).toBe("fix tests");
      expect(bookmarks[0].prompt).toBe("run npm test and fix failures");
      expect(bookmarks[0].id).toBeDefined();
    });

    it("removeBookmark removes by id", () => {
      getState().addProject("p", "/p");
      getState().addBookmark("bm1", "prompt1");
      getState().addBookmark("bm2", "prompt2");
      const id = getProjectBookmarks()[0].id;
      getState().removeBookmark(id);
      expect(getProjectBookmarks()).toHaveLength(1);
      expect(getProjectBookmarks()[0].name).toBe("bm2");
    });

    it("updateBookmark updates name and prompt", () => {
      getState().addProject("p", "/p");
      getState().addBookmark("old", "old prompt");
      const id = getProjectBookmarks()[0].id;
      getState().updateBookmark(id, "new", "new prompt");
      expect(getProjectBookmarks()[0].name).toBe("new");
      expect(getProjectBookmarks()[0].prompt).toBe("new prompt");
    });
  });

  // importPendingBookmarks tests removed — bookmark import is now event-driven
  // via Rust filesystem watcher (bookmark-pending/bookmark-scores events)

  describe("split pane", () => {
    it("splitSession creates vertical split with primarySid", () => {
      getState().addProject("p", "/p");
      getState().addSession("s2");
      const proj = getState().projects[0];
      const s1id = proj.sessions[0].id;
      const s2id = proj.sessions[1].id;
      getState().setActiveSession(s1id);
      getState().splitSession(s2id);
      const layout = getState().splitLayout;
      expect(layout.type).toBe("vertical");
      expect(layout.primarySid).toBe(s1id);
      expect(layout.secondarySid).toBe(s2id);
      expect(layout.ratio).toBe(0.5);
    });

    it("unsplit resets to none", () => {
      getState().addProject("p", "/p");
      getState().addSession("s2");
      const s2id = getState().projects[0].sessions[1].id;
      getState().splitSession(s2id);
      getState().unsplit();
      expect(getState().splitLayout.type).toBe("none");
    });

    it("setFocusedPane toggles pane", () => {
      getState().addProject("p", "/p");
      getState().setFocusedPane("secondary");
      expect(getState().focusedPane).toBe("secondary");
      getState().setFocusedPane("primary");
      expect(getState().focusedPane).toBe("primary");
    });

    it("setSplitRatio updates ratio", () => {
      getState().addProject("p", "/p");
      getState().setSplitRatio(0.7);
      expect(getState().splitLayout.ratio).toBe(0.7);
    });
  });

  describe("settings extended", () => {
    it("setEditor updates editor", () => {
      getState().setEditor("zed");
      expect(getState().settings.editor).toBe("zed");
    });

    it("setAutoUpdate updates autoUpdate", () => {
      getState().setAutoUpdate(false);
      expect(getState().settings.autoUpdate).toBe(false);
    });

    it("setDefaultMode updates defaultMode", () => {
      getState().setDefaultMode("yolo");
      expect(getState().settings.defaultMode).toBe("yolo");
    });

    it("setLanguage updates language", () => {
      getState().setLanguage("en");
      expect(getState().settings.language).toBe("en");
    });

    it("setFontSize clamps to 8-20 range", () => {
      getState().setFontSize(5);
      expect(getState().settings.fontSize).toBe(8);
      getState().setFontSize(25);
      expect(getState().settings.fontSize).toBe(20);
      getState().setFontSize(14);
      expect(getState().settings.fontSize).toBe(14);
    });
  });

});
