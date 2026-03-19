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
vi.mock("../../i18n/i18n", () => ({ useT: () => (key: string) => key, detectSystemLanguage: () => "fr" }));
vi.mock("../../features/updater", () => ({
  triggerManualUpdate: vi.fn(),
  installAndRestart: vi.fn(),
}));

import UpdateBanner from "../../features/UpdateBanner";
import type { UpdateStatus } from "../../features/updater";

describe("UpdateBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null on idle", () => {
    const status: UpdateStatus = { state: "idle" };
    const { container } = render(<UpdateBanner status={status} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows download button on available", () => {
    const status: UpdateStatus = { state: "available", version: "2.0.0" };
    const { getByText } = render(<UpdateBanner status={status} />);
    expect(getByText("update.download")).toBeTruthy();
  });

  it("shows progress on downloading", () => {
    const status: UpdateStatus = { state: "downloading", progress: 45 };
    const { container, getByText } = render(<UpdateBanner status={status} />);
    expect(getByText("update.downloading")).toBeTruthy();
    const bar = container.querySelector(".update-banner__bar") as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.style.width).toBe("45%");
  });

  it("shows restart button on ready", () => {
    const status: UpdateStatus = { state: "ready", version: "2.0.0" };
    const { getByText } = render(<UpdateBanner status={status} />);
    expect(getByText("update.restart")).toBeTruthy();
  });

  it("shows error message on error", () => {
    const status: UpdateStatus = { state: "error", message: "Network failed" };
    const { getByText } = render(<UpdateBanner status={status} />);
    expect(getByText("update.error")).toBeTruthy();
  });
});
