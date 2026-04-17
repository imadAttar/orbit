import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn().mockRejectedValue(new Error("no fs")),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  BaseDirectory: { Home: 1 },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("../../i18n/i18n", () => ({ useT: () => (key: string) => key, detectSystemLanguage: () => "fr" }));
vi.mock("../../lib/themes", () => ({
  THEMES: {
    orbit: { label: "Orbit" },
    dracula: { label: "Dracula" },
  },
}));

import StatusBar from "../../layout/StatusBar";
import { useStore } from "../../core/store";

function setupStore(overrides: Record<string, unknown> = {}) {
  useStore.setState({
    projects: [{
      id: "p1", name: "TestProject", dir: "/home/user/project",
      sessions: [{ id: "s1", name: "Main Session" }],
    }],
    activePid: "p1",
    activeSid: "s1",
    sessionCosts: {},
    sessionStates: {},
    sessionTools: {},
    settings: {
      terminal: "default" as const, editor: "vscode" as const, theme: "orbit" as const,
      fontSize: 14, sidebarWidth: 220, analytics: true, statuslineAsked: false,
      autoUpdate: true, defaultMode: "normal" as const, language: "fr" as const,
    },
    splitLayout: { type: "none" as const, primarySid: "", ratio: 0.5 },
    ...overrides,
  });
}

describe("StatusBar", () => {
  beforeEach(() => {
    cleanup();
    setupStore();
  });

  it("renders project dir", () => {
    const { getByText } = render(<StatusBar />);
    expect(getByText("/home/user/project")).toBeTruthy();
  });

  it("renders session name", () => {
    const { container } = render(<StatusBar />);
    expect(container.textContent).toContain("Main Session");
  });

  it("shows cost when defined", () => {
    setupStore({ sessionCosts: { s1: 1.5 } });
    const { getByText } = render(<StatusBar />);
    expect(getByText("$1.50")).toBeTruthy();
  });

  it("does not show cost when undefined", () => {
    const { container } = render(<StatusBar />);
    expect(container.querySelector(".status-bar__cost")).toBeNull();
  });

  it("shows Split badge when isSplit", () => {
    setupStore({ splitLayout: { type: "vertical", primarySid: "s1", secondarySid: "s2", ratio: 0.5 } });
    const { getByText } = render(<StatusBar />);
    expect(getByText("statusbar.split")).toBeTruthy();
  });

  it("does not show Split badge when not split", () => {
    const { container } = render(<StatusBar />);
    expect(container.querySelector(".status-bar__badge")).toBeNull();
  });
});
