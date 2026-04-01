import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn().mockRejectedValue(new Error("no fs")),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  BaseDirectory: { Home: 1 },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("../../lib/analytics", () => ({ trackEvent: vi.fn(), setAnalyticsEnabled: vi.fn() }));
vi.mock("../../i18n/i18n", () => ({ useT: () => (key: string) => key, detectSystemLanguage: () => "fr" }));
vi.mock("../../lib/platform", () => ({ modLabel: "Cmd", modSymbol: "\u2318", isMac: true, isWindows: false, isLinux: false, defaultTerminal: "default", terminalOptions: [] }));
vi.mock("../../shared/InlineRename", () => ({
  default: ({ value, onCancel }: { value: string; onConfirm: (v: string) => void; onCancel: () => void }) => (
    <input data-testid="inline-rename" defaultValue={value} onBlur={onCancel} />
  ),
}));

import TabBar from "../../layout/TabBar";
import { useStore } from "../../core/store";

function setupStore(overrides: Record<string, unknown> = {}) {
  useStore.setState({
    projects: [
      { id: "p1", name: "Alpha", dir: "/tmp/alpha", sessions: [{ id: "s1", name: "Session 1" }] },
      { id: "p2", name: "Beta", dir: "/tmp/beta", sessions: [{ id: "s2", name: "Session 1" }] },
    ],
    activePid: "p1",
    activeSid: "s1",
    settings: {
      terminal: "default" as const, editor: "vscode" as const, theme: "orbit" as const,
      fontSize: 11, sidebarWidth: 220, analytics: true, statuslineAsked: false,
      autoUpdate: true, defaultMode: "normal" as const, language: "fr" as const,
    },
    ...overrides,
  });
}

describe("TabBar", () => {
  const handlers = {
    onNewProject: vi.fn(),
    onCommandPalette: vi.fn(),
  };

  beforeEach(() => {
    cleanup();
    setupStore();
    Object.values(handlers).forEach((fn) => fn.mockClear());
  });

  it("renders project tabs", () => {
    const { getByText } = render(<TabBar {...handlers} />);
    expect(getByText("Alpha")).toBeTruthy();
    expect(getByText("Beta")).toBeTruthy();
  });

  it("click on tab updates store activePid", () => {
    const { container } = render(<TabBar {...handlers} />);
    const tabs = container.querySelectorAll(".tab");
    fireEvent.click(tabs[1]); // Beta
    expect(useStore.getState().activePid).toBe("p2");
  });

  it("active tab has active class", () => {
    setupStore({ activePid: "p2" });
    const { container } = render(<TabBar {...handlers} />);
    const tabs = container.querySelectorAll(".tab");
    expect(tabs[1].classList.contains("tab--active")).toBe(true);
    expect(tabs[0].classList.contains("tab--active")).toBe(false);
  });

  it("new project button calls onNewProject", () => {
    const { container } = render(<TabBar {...handlers} />);
    const btns = container.querySelectorAll(".tab-bar__btn");
    fireEvent.click(btns[0]);
    expect(handlers.onNewProject).toHaveBeenCalled();
  });
});
