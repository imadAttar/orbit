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

import InlineRename from "../../shared/InlineRename";

describe("InlineRename", () => {
  const onConfirm = vi.fn<(v: string) => void>();
  const onCancel = vi.fn<() => void>();

  beforeEach(() => {
    cleanup();
    onConfirm.mockClear();
    onCancel.mockClear();
  });

  it("renders with initial value", () => {
    const { container } = render(
      <InlineRename value="Session 1" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    const input = container.querySelector(".inline-rename") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("Session 1");
  });

  it("Enter confirms with trimmed value", () => {
    const { container } = render(
      <InlineRename value="old" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    const input = container.querySelector(".inline-rename") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  new name  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledWith("new name");
  });

  it("Escape cancels", () => {
    const { container } = render(
      <InlineRename value="old" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    const input = container.querySelector(".inline-rename") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("empty input on Enter falls back to original value", () => {
    const { container } = render(
      <InlineRename value="original" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    const input = container.querySelector(".inline-rename") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledWith("original");
  });

  it("blur confirms with current value", () => {
    const { container } = render(
      <InlineRename value="old" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    const input = container.querySelector(".inline-rename") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "blurred" } });
    fireEvent.blur(input);
    expect(onConfirm).toHaveBeenCalledWith("blurred");
  });
});
