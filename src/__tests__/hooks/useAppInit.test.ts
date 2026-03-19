import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

// Mock dependencies before imports
const mockInit = vi.fn().mockResolvedValue(undefined);
const mockIsInstalled = vi.fn().mockResolvedValue(true);
const mockHasStatusline = vi.fn().mockResolvedValue(true);
const mockListen = vi.fn().mockResolvedValue(() => {});
const mockInitAnalytics = vi.fn();
const mockTrackEvent = vi.fn();
const mockInitUpdater = vi.fn();
const mockOnUpdateStatus = vi.fn().mockReturnValue(() => {});
const mockSetStatuslineAsked = vi.fn();

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn().mockRejectedValue(new Error("no fs")),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  BaseDirectory: { Home: 1 },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../lib/analytics", () => ({
  initAnalytics: (...args: unknown[]) => mockInitAnalytics(...args),
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  setAnalyticsEnabled: vi.fn(),
}));
vi.mock("../../core/api", () => ({
  claude: { isInstalled: () => mockIsInstalled() },
  statusline: { has: () => mockHasStatusline() },
  listen: (...args: unknown[]) => mockListen(...args),
  pty: { spawn: vi.fn(), write: vi.fn(), kill: vi.fn(), killSilent: vi.fn(), resize: vi.fn() },
  orbit: { readFile: vi.fn(), writeFile: vi.fn() },
}));
vi.mock("../../features/updater", () => ({
  initUpdater: () => mockInitUpdater(),
  onUpdateStatus: (cb: unknown) => mockOnUpdateStatus(cb),
}));
vi.mock("../../lib/platform", () => ({
  isWindows: false,
  isMac: true,
  isLinux: false,
  defaultTerminal: "iterm2",
}));
vi.mock("../../i18n/i18n", () => ({
  useT: () => (key: string) => key,
  detectSystemLanguage: () => "fr",
}));

import { useStore } from "../../core/store";
import { useAppInit } from "../../hooks/useAppInit";

describe("useAppInit", () => {
  const dispatch = vi.fn();

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useStore.setState({
      init: mockInit,
      settings: {
        terminal: "iterm2",
        editor: "vscode",
        theme: "orbit",
        fontSize: 11,
        sidebarWidth: 200,
        analytics: true,
        statuslineAsked: false,
        autoUpdate: true,
        defaultMode: "normal",
        language: "fr",
      },
      projects: [
        { id: "p1", name: "Test", dir: "/tmp", sessions: [{ id: "s1", name: "main" }] },
      ],
      activePid: "p1",
      activeSid: "s1",
      setStatuslineAsked: mockSetStatuslineAsked,
    });
  });

  afterEach(() => cleanup());

  it("calls store.init() on mount", async () => {
    renderHook(() => useAppInit(dispatch));
    await vi.waitFor(() => expect(mockInit).toHaveBeenCalledOnce());
  });

  it("initializes analytics with setting value", async () => {
    renderHook(() => useAppInit(dispatch));
    await vi.waitFor(() => expect(mockInitAnalytics).toHaveBeenCalledWith(true));
  });

  it("tracks app_launched event", async () => {
    renderHook(() => useAppInit(dispatch));
    await vi.waitFor(() =>
      expect(mockTrackEvent).toHaveBeenCalledWith("app_launched", expect.objectContaining({
        theme: "orbit",
        fontSize: 11,
        projects: 1,
        sessions: 1,
      })),
    );
  });

  it("calls initUpdater", async () => {
    renderHook(() => useAppInit(dispatch));
    await vi.waitFor(() => expect(mockInitUpdater).toHaveBeenCalled());
  });

  it("dispatches showInstallClaude when Claude not installed", async () => {
    mockIsInstalled.mockResolvedValueOnce(false);
    renderHook(() => useAppInit(dispatch));
    await vi.waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: "set",
        field: "showInstallClaude",
        value: true,
      }),
    );
  });

  it("dispatches showStatuslinePrompt when statusline missing", async () => {
    mockHasStatusline.mockResolvedValueOnce(false);
    renderHook(() => useAppInit(dispatch));
    await vi.waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: "set",
        field: "showStatuslinePrompt",
        value: true,
      }),
    );
  });

  it("calls setStatuslineAsked when statusline already exists", async () => {
    mockHasStatusline.mockResolvedValueOnce(true);
    renderHook(() => useAppInit(dispatch));
    await vi.waitFor(() => expect(mockSetStatuslineAsked).toHaveBeenCalled());
  });

  it("skips statusline check when statuslineAsked is true", async () => {
    useStore.setState({
      settings: { ...useStore.getState().settings, statuslineAsked: true },
    });
    renderHook(() => useAppInit(dispatch));
    await vi.waitFor(() => expect(mockInitUpdater).toHaveBeenCalled());
    expect(mockHasStatusline).not.toHaveBeenCalled();
  });

  it("subscribes to update status", () => {
    renderHook(() => useAppInit(dispatch));
    expect(mockOnUpdateStatus).toHaveBeenCalledWith(expect.any(Function));
  });

  it("listens for menu-event", () => {
    renderHook(() => useAppInit(dispatch));
    expect(mockListen).toHaveBeenCalledWith("menu-event", expect.any(Function));
  });

  it("cleans up menu-event listener on unmount", async () => {
    const unlisten = vi.fn();
    mockListen.mockResolvedValueOnce(unlisten);
    const { unmount } = renderHook(() => useAppInit(dispatch));
    await vi.waitFor(() => expect(mockListen).toHaveBeenCalled());
    unmount();
    expect(unlisten).toHaveBeenCalled();
  });
});
