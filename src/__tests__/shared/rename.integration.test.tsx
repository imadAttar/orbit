import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

const state = vi.hoisted(() => ({
  projects: [{ id: "project", name: "Project", dir: "/tmp/project", sessions: [{ id: "session", name: "Session", type: "terminal" }] }],
  activePid: "project", activeSid: "session", settings: { sidebarWidth: 220 },
  sessionStates: {}, sessionCosts: {},
  setActiveProject: vi.fn(), removeProject: vi.fn(), renameProject: vi.fn(),
  setActiveSession: vi.fn(), removeSession: vi.fn(), renameSession: vi.fn(), addSession: vi.fn(),
}));
vi.mock("../../core/store", () => ({
  useStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), { getState: () => state }),
  selectActiveProject: (s: typeof state) => s.projects[0],
}));
vi.mock("../../i18n/i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("../../lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("../../features/activity/ActivityPanel", () => ({ default: () => null }));

import TabBar from "../../layout/TabBar";
import Sidebar from "../../layout/Sidebar";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe.each(["project", "session"] as const)("real %s rename integration", (kind) => {
  function openRename() {
    const view = render(kind === "project" ? <TabBar onNewProject={vi.fn()} /> : <Sidebar onContextMenu={vi.fn()} />);
    fireEvent.doubleClick(view.getByText(kind === "project" ? "Project" : "Session"));
    return { view, input: view.getByTestId("inline-rename-input") as HTMLInputElement };
  }

  it("allows a space without activating the surrounding project/session", () => {
    const { input } = openRename();
    expect(fireEvent.keyDown(input, { key: " " })).toBe(true);
    fireEvent.change(input, { target: { value: "New name" } });
    expect(input.value).toBe("New name");
    expect(state.setActiveProject).not.toHaveBeenCalled();
    expect(state.setActiveSession).not.toHaveBeenCalled();
  });

  it("confirms with Enter without activating its parent", () => {
    const { view, input } = openRename();
    fireEvent.change(input, { target: { value: "  New name  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(kind === "project" ? state.renameProject : state.renameSession).toHaveBeenCalledExactlyOnceWith(kind, "New name");
    expect(view.queryByTestId("inline-rename-input")).toBeNull();
    expect(state.setActiveProject).not.toHaveBeenCalled();
    expect(state.setActiveSession).not.toHaveBeenCalled();
  });

  it("cancels Escape without committing the edited value", () => {
    const { view, input } = openRename();
    fireEvent.change(input, { target: { value: "Discard me" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(view.queryByTestId("inline-rename-input")).toBeNull();
    expect(state.renameProject).not.toHaveBeenCalled();
    expect(state.renameSession).not.toHaveBeenCalled();
  });
});
