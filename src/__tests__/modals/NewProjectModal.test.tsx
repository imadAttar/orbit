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
vi.mock("../../shared/FocusTrap", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockAddProject = vi.fn();
vi.mock("../../core/store", () => ({
  useStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ addProject: mockAddProject }),
}));

import NewProjectModal from "../../modals/NewProjectModal";

describe("NewProjectModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with title", () => {
    const { getByText } = render(<NewProjectModal onClose={vi.fn()} />);
    expect(getByText("project.new")).toBeTruthy();
  });

  it("mode tabs switch between open and create", () => {
    const { container } = render(<NewProjectModal onClose={vi.fn()} />);
    const tabs = container.querySelectorAll(".modal__tab");
    expect(tabs.length).toBe(2);

    // Initially first tab (open) is active
    expect(tabs[0].classList.contains("modal__tab--active")).toBe(true);
    expect(tabs[1].classList.contains("modal__tab--active")).toBe(false);

    // Switch to create mode
    fireEvent.click(tabs[1]);
    expect(tabs[1].classList.contains("modal__tab--active")).toBe(true);
    expect(tabs[0].classList.contains("modal__tab--active")).toBe(false);
  });

  it("submit button disabled when fields empty", () => {
    const { container } = render(<NewProjectModal onClose={vi.fn()} />);
    const submitBtn = container.querySelector(".modal__btn--primary") as HTMLButtonElement;
    expect(submitBtn).toBeTruthy();
    expect(submitBtn.disabled).toBe(true);
  });

  it("cancel calls onClose", () => {
    const onClose = vi.fn();
    const { container } = render(<NewProjectModal onClose={onClose} />);
    const actions = container.querySelector(".modal__actions");
    const cancelBtn = actions?.querySelector(".modal__btn--secondary") as HTMLElement;
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalled();
  });
});
