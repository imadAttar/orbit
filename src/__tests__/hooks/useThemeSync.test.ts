import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

const mockApplyChrome = vi.fn();

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
  trackEvent: vi.fn(),
  initAnalytics: vi.fn(),
  setAnalyticsEnabled: vi.fn(),
}));
vi.mock("../../lib/themes", () => {
  const fakeTheme = {
    label: "Test",
    terminal: { background: "#000", foreground: "#fff" },
    chrome: {
      bg: "#000", sidebarBg: "#111", border: "#222", accent: "#33f",
      sessionActive: "#444", codeBg: "#555", text: "#fff", textDim: "#aaa",
      textBright: "#fff", green: "#0f0", yellow: "#ff0", danger: "#f00",
    },
  };
  return {
    THEMES: { orbit: fakeTheme, "orbit-light": fakeTheme } as Record<string, typeof fakeTheme>,
    applyChrome: (...args: unknown[]) => mockApplyChrome(...args),
  };
});
vi.mock("../../i18n/i18n", () => ({
  useT: () => (key: string) => key,
  detectSystemLanguage: () => "fr",
}));

import { useStore } from "../../core/store";
import { useThemeSync } from "../../hooks/useThemeSync";

describe("useThemeSync", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useStore.setState({
      settings: {
        terminal: "iterm2",
        editor: "vscode",
        theme: "orbit",
        fontSize: 11,
        sidebarWidth: 200,
        analytics: true,
        statuslineAsked: false,
        autoUpdate: true, autoNotifications: true,
        defaultMode: "normal",
        language: "fr",
      },
    });
  });

  afterEach(() => cleanup());

  it("applies theme on mount", () => {
    renderHook(() => useThemeSync());
    expect(mockApplyChrome).toHaveBeenCalledOnce();
    expect(mockApplyChrome).toHaveBeenCalledWith(
      expect.objectContaining({ chrome: expect.any(Object) }),
    );
  });

  it("re-applies when theme changes", async () => {
    renderHook(() => useThemeSync());
    mockApplyChrome.mockClear();

    useStore.setState({
      settings: { ...useStore.getState().settings, theme: "orbit-light" },
    });

    await vi.waitFor(() => expect(mockApplyChrome).toHaveBeenCalledOnce());
  });

  it("does not apply for unknown theme", () => {
    useStore.setState({
      settings: { ...useStore.getState().settings, theme: "nonexistent" as never },
    });
    mockApplyChrome.mockClear();
    renderHook(() => useThemeSync());
    expect(mockApplyChrome).not.toHaveBeenCalled();
  });
});
