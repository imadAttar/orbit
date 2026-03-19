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
import type { Project } from "../../core/types";

describe("Sidebar", () => {
  const sessions = [
    { id: "s1", name: "Session 1" },
    { id: "s2", name: "Session 2" },
    { id: "s3", name: "Session 3" },
  ];
  const activeProject: Project = {
    id: "p1",
    name: "Test Project",
    dir: "/tmp/test",
    sessions,
  };

  const handlers = {
    onSelectSession: vi.fn<(sid: string) => void>(),
    onClearNotification: vi.fn<(sid: string) => void>(),
    onRenameSession: vi.fn<(sid: string, name: string) => void>(),
    onAddSession: vi.fn<() => void>(),
    onContextMenu: vi.fn<(sid: string, x: number, y: number) => void>(),
    onOpenSkillSession: vi.fn<(name: string, command: string) => void>(),
    onOpenPromptCoach: vi.fn<() => void>(),
    onSendToSession: vi.fn<(prompt: string) => void>(),
  };

  beforeEach(() => {
    cleanup();
    Object.values(handlers).forEach((fn) => fn.mockClear());
  });

  const renderSidebar = (overrides: Record<string, unknown> = {}) =>
    render(
      <Sidebar
        activeProject={activeProject}
        activeSid="s1"
        notifiedSessions={{}}
        sessionCosts={{}}
        sidebarWidth={220}
        {...handlers}
        {...overrides}
      />,
    );

  it("renders session list", () => {
    const { container } = renderSidebar();
    const items = container.querySelectorAll(".session-item");
    expect(items.length).toBe(3);
    expect(items[0]?.textContent).toContain("Session 1");
    expect(items[1]?.textContent).toContain("Session 2");
    expect(items[2]?.textContent).toContain("Session 3");
  });

  it("marks active session", () => {
    const { container } = renderSidebar({ activeSid: "s2" });
    const items = container.querySelectorAll(".session-item");
    expect(items[0]?.classList.contains("session-item--active")).toBe(false);
    expect(items[1]?.classList.contains("session-item--active")).toBe(true);
  });

  it("click on session calls onSelectSession and onClearNotification", () => {
    const { container } = renderSidebar();
    const items = container.querySelectorAll(".session-item");
    fireEvent.click(items[1]!);
    expect(handlers.onSelectSession).toHaveBeenCalledWith("s2");
    expect(handlers.onClearNotification).toHaveBeenCalledWith("s2");
  });

  it("shows notification badge when session is notified", () => {
    const { container } = renderSidebar({
      notifiedSessions: { s2: true },
    });
    const items = container.querySelectorAll(".session-item");
    // s2 should have the notified class
    expect(items[1]?.classList.contains("session-item--notified")).toBe(true);
    // s2 should have a badge
    const badge = items[1]?.querySelector(".session-item__badge");
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe("session.ready");
  });

  it("does not show notification badge for non-notified sessions", () => {
    const { container } = renderSidebar({
      notifiedSessions: { s2: true },
    });
    const items = container.querySelectorAll(".session-item");
    expect(items[0]?.querySelector(".session-item__badge")).toBeNull();
  });

  it("shows cost for session", () => {
    const { container } = renderSidebar({
      sessionCosts: { s1: 1.5, s3: 0.25 },
    });
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

  it("add session button calls onAddSession", () => {
    const { container } = renderSidebar();
    const addBtn = container.querySelector(".sidebar__add-btn") as HTMLElement;
    fireEvent.click(addBtn);
    expect(handlers.onAddSession).toHaveBeenCalled();
  });

  it("renders skill buttons", () => {
    const { container } = renderSidebar();
    const skillBtns = container.querySelectorAll(".sidebar__skill-btn");
    expect(skillBtns.length).toBe(4);
  });
});
