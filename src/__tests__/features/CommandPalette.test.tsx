import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

// Mock Tauri
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn().mockRejectedValue(new Error("no fs")),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
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
vi.mock("../../i18n/i18n", () => ({
  useT: () => (key: string) => key,
  detectSystemLanguage: () => "fr",
}));

import CommandPalette from "../../features/CommandPalette";
import { useStore } from "../../core/store";

describe("CommandPalette", () => {
  const onClose = vi.fn<() => void>();
  const onSelectPrompt = vi.fn<(p: string) => void>();

  beforeEach(() => {
    cleanup();
    onClose.mockClear();
    onSelectPrompt.mockClear();
    // Reset with a project that has empty bookmarks
    useStore.setState({
      projects: [{ id: "p1", name: "Test", dir: "/test", sessions: [{ id: "s1", name: "main" }], bookmarks: [] }],
      activePid: "p1",
      activeSid: "s1",
    });
  });

  it("renders with empty bookmarks and shows builtin actions", () => {
    const { container } = render(
      <CommandPalette onClose={onClose} onSelectPrompt={onSelectPrompt} />,
    );
    // Should render the input
    const input = container.querySelector(".command-palette__input");
    expect(input).toBeTruthy();
    // Builtin actions should be visible (skills section)
    expect(container.textContent).toContain("palette.skills");
  });

  it("shows empty state when search matches nothing", () => {
    const { container } = render(
      <CommandPalette onClose={onClose} onSelectPrompt={onSelectPrompt} />,
    );
    const input = container.querySelector(".command-palette__input")!;
    fireEvent.change(input, { target: { value: "zzzznothing" } });
    expect(container.textContent).toContain("palette.noResults");
  });

  it("search filters bookmarks by name", () => {
    useStore.setState({
      projects: [{ id: "p1", name: "Test", dir: "/test", sessions: [{ id: "s1", name: "main" }], bookmarks: [
        { id: "1", name: "Deploy prod", prompt: "deploy to production" },
        { id: "2", name: "Run tests", prompt: "run all tests" },
      ] }],
      activePid: "p1",
      activeSid: "s1",
    });
    const { container } = render(
      <CommandPalette onClose={onClose} onSelectPrompt={onSelectPrompt} />,
    );
    const input = container.querySelector(".command-palette__input")!;
    fireEvent.change(input, { target: { value: "deploy" } });
    const items = container.querySelectorAll(".command-palette__item");
    // Should only show "Deploy prod" bookmark (builtins won't match "deploy")
    const names = Array.from(items).map((el) => el.textContent);
    expect(names.some((t) => t?.includes("Deploy prod"))).toBe(true);
    expect(names.some((t) => t?.includes("Run tests"))).toBe(false);
  });

  it("Enter on selected item calls onSelectPrompt", () => {
    useStore.setState({
      projects: [{ id: "p1", name: "Test", dir: "/test", sessions: [{ id: "s1", name: "main" }], bookmarks: [
        { id: "1", name: "My bookmark", prompt: "do the thing" },
      ] }],
      activePid: "p1",
      activeSid: "s1",
    });
    const { container } = render(
      <CommandPalette onClose={onClose} onSelectPrompt={onSelectPrompt} />,
    );
    const palette = container.querySelector(".command-palette")!;
    // selectedIdx starts at 0 which is the first bookmark (project skills first)
    fireEvent.keyDown(palette, { key: "Enter" });
    expect(onSelectPrompt).toHaveBeenCalledWith("do the thing");
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape calls onClose", () => {
    const { container } = render(
      <CommandPalette onClose={onClose} onSelectPrompt={onSelectPrompt} />,
    );
    const palette = container.querySelector(".command-palette")!;
    fireEvent.keyDown(palette, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("Arrow keys navigate selected index", () => {
    useStore.setState({
      projects: [{ id: "p1", name: "Test", dir: "/test", sessions: [{ id: "s1", name: "main" }], bookmarks: [
        { id: "1", name: "First", prompt: "first" },
        { id: "2", name: "Second", prompt: "second" },
      ] }],
      activePid: "p1",
      activeSid: "s1",
    });
    const { container } = render(
      <CommandPalette onClose={onClose} onSelectPrompt={onSelectPrompt} />,
    );
    const palette = container.querySelector(".command-palette")!;

    // Initially first item is selected (index 0)
    let selected = container.querySelector(".command-palette__item--selected");
    expect(selected).toBeTruthy();

    // Arrow down moves selection
    fireEvent.keyDown(palette, { key: "ArrowDown" });
    const items = container.querySelectorAll(".command-palette__item");
    selected = container.querySelector(".command-palette__item--selected");
    expect(selected).toBeTruthy();
    // The second item should now be selected
    expect(items[1]?.classList.contains("command-palette__item--selected")).toBe(true);

    // Arrow up moves selection back
    fireEvent.keyDown(palette, { key: "ArrowUp" });
    selected = container.querySelector(".command-palette__item--selected");
    expect(items[0]?.classList.contains("command-palette__item--selected")).toBe(true);
  });

  it("Enter on builtin action calls onSelectPrompt with command", () => {
    const { container } = render(
      <CommandPalette onClose={onClose} onSelectPrompt={onSelectPrompt} />,
    );
    const palette = container.querySelector(".command-palette")!;
    // First item is the first builtin (/bootstrap)
    fireEvent.keyDown(palette, { key: "Enter" });
    expect(onSelectPrompt).toHaveBeenCalledWith("/bootstrap");
    expect(onClose).toHaveBeenCalled();
  });
});
