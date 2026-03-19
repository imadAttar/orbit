import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

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
import type { Project, Session } from "../../core/types";

const session: Session = { id: "s1", name: "Main Session" };
const project: Project = { id: "p1", name: "TestProject", dir: "/home/user/project", sessions: [session] };

const defaultProps = () => ({
  activeProject: project,
  activeSession: session,
  activeCost: undefined as number | undefined,
  isSplit: false,
  theme: "orbit",
  fontSize: 14,
});

describe("StatusBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders project dir", () => {
    const { getByText } = render(<StatusBar {...defaultProps()} />);
    expect(getByText("/home/user/project")).toBeTruthy();
  });

  it("renders session name", () => {
    const { container } = render(<StatusBar {...defaultProps()} />);
    expect(container.textContent).toContain("Main Session");
  });

  it("shows cost when defined", () => {
    const props = defaultProps();
    props.activeCost = 1.5;
    const { getByText } = render(<StatusBar {...props} />);
    expect(getByText("$1.50")).toBeTruthy();
  });

  it("does not show cost when undefined", () => {
    const { container } = render(<StatusBar {...defaultProps()} />);
    expect(container.querySelector(".status-bar__cost")).toBeNull();
  });

  it("shows Split badge when isSplit", () => {
    const props = defaultProps();
    props.isSplit = true;
    const { getByText } = render(<StatusBar {...props} />);
    expect(getByText("statusbar.split")).toBeTruthy();
  });

  it("does not show Split badge when not split", () => {
    const { container } = render(<StatusBar {...defaultProps()} />);
    expect(container.querySelector(".status-bar__badge")).toBeNull();
  });
});
