import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn().mockRejectedValue(new Error("no fs")),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  BaseDirectory: { Home: 1 },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("../../i18n/i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("../../lib/platform", () => ({ modLabel: "Cmd", modSymbol: "\u2318" }));
vi.mock("../../shared/InlineRename", () => ({
  default: ({ value, onCancel }: { value: string; onConfirm: (v: string) => void; onCancel: () => void }) => (
    <input data-testid="inline-rename" defaultValue={value} onBlur={onCancel} />
  ),
}));

import TabBar from "../../layout/TabBar";
import type { Project } from "../../core/types";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "My Project",
    dir: "/tmp/project",
    sessions: [{ id: "s1", name: "Session 1" }],
    ...overrides,
  };
}

const defaultProps = () => ({
  projects: [makeProject()],
  activePid: "p1",
  notifiedSessions: {} as Record<string, boolean>,
  onSelectProject: vi.fn(),
  onRenameProject: vi.fn(),
  onRemoveProject: vi.fn(),
  onClearNotification: vi.fn(),
  onNewProject: vi.fn(),
  onCommandPalette: vi.fn(),
  onOpenTerminal: vi.fn(),
});

describe("TabBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders project tabs", () => {
    const props = defaultProps();
    props.projects = [
      makeProject({ id: "p1", name: "Alpha" }),
      makeProject({ id: "p2", name: "Beta" }),
    ];
    const { getByText } = render(<TabBar {...props} />);
    expect(getByText("Alpha")).toBeTruthy();
    expect(getByText("Beta")).toBeTruthy();
  });

  it("click on tab calls onSelectProject", () => {
    const props = defaultProps();
    props.projects = [
      makeProject({ id: "p1", name: "Alpha" }),
      makeProject({ id: "p2", name: "Beta" }),
    ];
    props.activePid = "p1";
    const { container } = render(<TabBar {...props} />);
    const tabs = container.querySelectorAll(".tab");
    fireEvent.click(tabs[1]); // Beta
    expect(props.onSelectProject).toHaveBeenCalledWith("p2");
  });

  it("active tab has active class", () => {
    const props = defaultProps();
    props.projects = [
      makeProject({ id: "p1", name: "Alpha" }),
      makeProject({ id: "p2", name: "Beta" }),
    ];
    props.activePid = "p2";
    const { container } = render(<TabBar {...props} />);
    const tabs = container.querySelectorAll(".tab");
    expect(tabs[1].classList.contains("tab--active")).toBe(true);
    expect(tabs[0].classList.contains("tab--active")).toBe(false);
  });

  it("new project button calls onNewProject", () => {
    const props = defaultProps();
    const { container } = render(<TabBar {...props} />);
    const btns = container.querySelectorAll(".tab-bar__btn");
    fireEvent.click(btns[0]); // first tab-bar__btn is "+"
    expect(props.onNewProject).toHaveBeenCalled();
  });
});
