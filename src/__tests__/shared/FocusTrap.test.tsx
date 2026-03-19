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
}));

import FocusTrap from "../../shared/FocusTrap";

describe("FocusTrap", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders children", () => {
    const { container } = render(
      <FocusTrap>
        <span>child content</span>
      </FocusTrap>,
    );
    expect(container.textContent).toContain("child content");
  });

  it("focuses first focusable element on mount", () => {
    const { container } = render(
      <FocusTrap>
        <button data-testid="btn1">First</button>
        <button data-testid="btn2">Second</button>
      </FocusTrap>,
    );
    const btn1 = container.querySelector("[data-testid='btn1']");
    expect(document.activeElement).toBe(btn1);
  });

  it("Tab cycles from last to first element", () => {
    const { container } = render(
      <FocusTrap>
        <button data-testid="btn1">First</button>
        <button data-testid="btn2">Second</button>
      </FocusTrap>,
    );
    const btn1 = container.querySelector("[data-testid='btn1']") as HTMLElement;
    const btn2 = container.querySelector("[data-testid='btn2']") as HTMLElement;

    // Focus last element
    btn2.focus();
    expect(document.activeElement).toBe(btn2);

    // Tab on last element should wrap to first
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(btn1);
  });

  it("Shift+Tab cycles from first to last element", () => {
    const { container } = render(
      <FocusTrap>
        <button data-testid="btn1">First</button>
        <button data-testid="btn2">Second</button>
      </FocusTrap>,
    );
    const btn1 = container.querySelector("[data-testid='btn1']") as HTMLElement;
    const btn2 = container.querySelector("[data-testid='btn2']") as HTMLElement;

    // First element is focused on mount
    expect(document.activeElement).toBe(btn1);

    // Shift+Tab on first element should wrap to last
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(btn2);
  });

  it("restores focus on unmount", () => {
    // Create an outside element and focus it
    const outer = document.createElement("button");
    outer.textContent = "outer";
    document.body.appendChild(outer);
    outer.focus();
    expect(document.activeElement).toBe(outer);

    const { unmount } = render(
      <FocusTrap>
        <button>Inside</button>
      </FocusTrap>,
    );

    // FocusTrap should have moved focus inside
    expect(document.activeElement).not.toBe(outer);

    // On unmount, focus should be restored
    unmount();
    expect(document.activeElement).toBe(outer);

    document.body.removeChild(outer);
  });
});
