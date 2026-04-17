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

import Sidebar from "../../layout/Sidebar";
import { useStore } from "../../core/store";

const sessions = [
  { id: "s1", name: "Session 1" },
  { id: "s2", name: "Session 2" },
  { id: "s3", name: "Session 3" },
];

function setupStore(overrides: Record<string, unknown> = {}) {
  useStore.setState({
    projects: [{
      id: "p1",
      name: "Test Project",
      dir: "/tmp/test",
      sessions,
    }],
    activePid: "p1",
    activeSid: "s1",
    sessionCosts: {},
    settings: {
      terminal: "default" as const,
      editor: "vscode" as const,
      theme: "orbit" as const,
      fontSize: 11,
      sidebarWidth: 220,
      analytics: true,
      statuslineAsked: false,
      autoUpdate: true,
      defaultMode: "normal" as const,
      language: "fr" as const,
    },
    ...overrides,
  });
}

describe("Sidebar", () => {
  const handlers = {
    onContextMenu: vi.fn<(sid: string, x: number, y: number) => void>(),
  };

  beforeEach(() => {
    cleanup();
    setupStore();
    Object.values(handlers).forEach((fn) => fn.mockClear());
  });

  const renderSidebar = () =>
    render(<Sidebar {...handlers} />);

  it("renders session list", () => {
    const { container } = renderSidebar();
    const items = container.querySelectorAll(".session-item");
    expect(items.length).toBe(3);
    expect(items[0]?.textContent).toContain("Session 1");
    expect(items[1]?.textContent).toContain("Session 2");
    expect(items[2]?.textContent).toContain("Session 3");
  });

  it("marks active session", () => {
    setupStore({ activeSid: "s2" });
    const { container } = renderSidebar();
    const items = container.querySelectorAll(".session-item");
    expect(items[0]?.classList.contains("session-item--active")).toBe(false);
    expect(items[1]?.classList.contains("session-item--active")).toBe(true);
  });

  it("click on session updates store", () => {
    const { container } = renderSidebar();
    const items = container.querySelectorAll(".session-item");
    fireEvent.click(items[1]!);
    expect(useStore.getState().activeSid).toBe("s2");
  });

  it("shows cost for session", () => {
    setupStore({ sessionCosts: { s1: 1.5, s3: 0.25 } });
    const { container } = renderSidebar();
    const items = container.querySelectorAll(".session-item");
    const costS1 = items[0]?.querySelector(".session-item__cost");
    expect(costS1).toBeTruthy();
    expect(costS1?.textContent).toBe("$1.50");

    const costS2 = items[1]?.querySelector(".session-item__cost");
    expect(costS2).toBeNull();

    const costS3 = items[2]?.querySelector(".session-item__cost");
    expect(costS3?.textContent).toBe("$0.25");
  });

  it("shows session index for first 9 sessions", () => {
    const { container } = renderSidebar();
    const indices = container.querySelectorAll(".session-item__index");
    expect(indices.length).toBe(3);
    expect(indices[0]?.textContent).toBe("1");
    expect(indices[1]?.textContent).toBe("2");
    expect(indices[2]?.textContent).toBe("3");
  });

  it("add session button creates a new session", () => {
    const { container } = renderSidebar();
    const addBtn = (container.querySelector("[data-testid='add-claude-session']") ?? container.querySelector(".sidebar__group-add")) as HTMLElement;
    fireEvent.click(addBtn);
    const proj = useStore.getState().projects.find((p) => p.id === "p1");
    expect(proj?.sessions.length).toBe(4);
  });
});
