import { describe, it, expect, beforeEach, vi } from "vitest";

const mockCheck = vi.fn();
const mockRelaunch = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mockCheck,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: mockRelaunch,
}));

vi.mock("../../lib/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("../../core/store", () => ({
  useStore: {
    getState: () => ({
      settings: { autoUpdate: false },
    }),
  },
}));

import {
  onUpdateStatus,
  checkForUpdates,
  getUpdateStatus,
  triggerManualUpdate,
  installAndRestart,
} from "../../features/updater";
import type { UpdateStatus } from "../../features/updater";

describe("updater", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset internal state by checking for no update
    mockCheck.mockResolvedValue(null);
  });

  async function resetToIdle() {
    mockCheck.mockResolvedValue(null);
    await checkForUpdates();
  }

  it("onUpdateStatus calls listener immediately with current status", async () => {
    await resetToIdle();
    const fn = vi.fn();
    onUpdateStatus(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ state: "idle" });
  });

  it("onUpdateStatus unsubscribe works", async () => {
    await resetToIdle();
    const fn = vi.fn();
    const unsub = onUpdateStatus(fn);
    fn.mockClear();
    unsub();
    // Trigger a check to change status — listener should NOT be called
    mockCheck.mockResolvedValue(null);
    await checkForUpdates();
    expect(fn).not.toHaveBeenCalled();
  });

  it("checkForUpdates sets state to checking then available when update exists", async () => {
    await resetToIdle();
    const states: UpdateStatus[] = [];
    const unsub = onUpdateStatus((s) => states.push(s));

    mockCheck.mockResolvedValue({
      version: "2.0.0",
      body: "release notes",
      downloadAndInstall: vi.fn(),
    });

    // Clear states collected so far (the initial call from onUpdateStatus)
    states.length = 0;

    await checkForUpdates();
    unsub();

    expect(states.some((s) => s.state === "checking")).toBe(true);
    const available = states.find((s) => s.state === "available");
    expect(available).toBeDefined();
    if (available && available.state === "available") {
      expect(available.version).toBe("2.0.0");
      expect(available.notes).toBe("release notes");
    }
  });

  it("checkForUpdates sets idle when no update", async () => {
    mockCheck.mockResolvedValue(null);
    await checkForUpdates();
    expect(getUpdateStatus().state).toBe("idle");
  });

  it("checkForUpdates sets idle on network error (message includes 404)", async () => {
    mockCheck.mockRejectedValue(new Error("HTTP 404 not found"));
    await checkForUpdates();
    expect(getUpdateStatus().state).toBe("idle");
  });

  it("checkForUpdates sets error on unknown error", async () => {
    mockCheck.mockRejectedValue(new Error("something went wrong"));
    await checkForUpdates();
    const status = getUpdateStatus();
    expect(status.state).toBe("error");
    if (status.state === "error") {
      expect(status.message).toBe("something went wrong");
    }
  });

  it("triggerManualUpdate does nothing when idle", async () => {
    await resetToIdle();
    await triggerManualUpdate();
    // Should still be idle — no crash, no state change
    expect(getUpdateStatus().state).toBe("idle");
  });

  it("installAndRestart calls relaunch", async () => {
    mockRelaunch.mockResolvedValue(undefined);
    await installAndRestart();
    expect(mockRelaunch).toHaveBeenCalledTimes(1);
  });

  it("getUpdateStatus returns current status", async () => {
    await resetToIdle();
    expect(getUpdateStatus()).toEqual({ state: "idle" });
  });
});
