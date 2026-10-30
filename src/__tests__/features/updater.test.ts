import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockCheck = vi.fn();
const mockRelaunch = vi.fn();
const mockSettings = vi.hoisted(() => ({ autoUpdate: false }));

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
      settings: mockSettings,
    }),
  },
}));

let onUpdateStatus: typeof import("../../features/updater").onUpdateStatus;
let checkForUpdates: typeof import("../../features/updater").checkForUpdates;
let getUpdateStatus: typeof import("../../features/updater").getUpdateStatus;
let triggerManualUpdate: typeof import("../../features/updater").triggerManualUpdate;
let installAndRestart: typeof import("../../features/updater").installAndRestart;
let initUpdater: typeof import("../../features/updater").initUpdater;
import type { UpdateStatus } from "../../features/updater";

describe("updater", () => {
  afterEach(() => {
    for (const [type, listener, options] of vi.mocked(document.addEventListener).mock.calls) {
      document.removeEventListener(type, listener, options);
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("does not schedule automatic network checks in development", async () => {
    vi.useFakeTimers();
    vi.stubEnv("DEV", true);
    initUpdater();
    expect(vi.getTimerCount()).toBe(0);
    expect(document.addEventListener).not.toHaveBeenCalled();
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
    expect(mockCheck).not.toHaveBeenCalled();
    await checkForUpdates();
    expect(mockCheck).toHaveBeenCalledOnce();
  });

  it("keeps the delayed automatic check in production", async () => {
    vi.useFakeTimers();
    vi.stubEnv("DEV", false);
    initUpdater();
    await vi.advanceTimersByTimeAsync(4999);
    expect(mockCheck).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mockCheck).toHaveBeenCalledOnce();
  });
  it("checks again six hours after the production startup check", async () => {
    vi.useFakeTimers();
    vi.stubEnv("DEV", false);
    initUpdater();
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockCheck).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 - 1);
    expect(mockCheck).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(mockCheck).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(mockCheck).toHaveBeenCalledTimes(3);
  });

  it("notifies about a release published after startup without changing preferences or restarting", async () => {
    vi.useFakeTimers();
    vi.stubEnv("DEV", false);
    const download = vi.fn();
    mockCheck.mockResolvedValueOnce(null).mockResolvedValue({
      version: "2.0.0", body: "new release", downloadAndInstall: download,
    });
    const listener = vi.fn();
    onUpdateStatus(listener);
    initUpdater();
    await vi.advanceTimersByTimeAsync(5000);
    expect(getUpdateStatus()).toEqual({ state: "idle" });
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    const available = { state: "available", version: "2.0.0", notes: "new release" };
    expect(getUpdateStatus()).toEqual(available);
    expect(listener).toHaveBeenLastCalledWith(available);
    await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
    expect(getUpdateStatus()).toEqual(available);
    expect(mockCheck).toHaveBeenCalledTimes(2);
    expect(download).not.toHaveBeenCalled();
    expect(mockRelaunch).not.toHaveBeenCalled();
    expect(mockSettings.autoUpdate).toBe(false);
  });

  it("initializes production timers only once", async () => {
    vi.useFakeTimers();
    vi.stubEnv("DEV", false);
    initUpdater();
    initUpdater();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockCheck).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("checks on visibility return only when six hours elapsed", async () => {
    vi.useFakeTimers();
    vi.stubEnv("DEV", false);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    initUpdater();
    initUpdater();
    expect(vi.mocked(document.addEventListener).mock.calls.filter(([type]) => type === "visibilitychange")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(mockCheck).toHaveBeenCalledOnce();
    // Simulate sleep: wall time advances, throttled timers do not fire.
    vi.setSystemTime(Date.now() + 6 * 60 * 60 * 1000);
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(mockCheck).toHaveBeenCalledOnce();
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(mockCheck).toHaveBeenCalledTimes(2);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(mockCheck).toHaveBeenCalledTimes(2);
  });

  it("does not start duplicate checks while a check is pending", async () => {
    vi.useFakeTimers();
    let resolve!: (value: null) => void;
    mockCheck.mockReturnValue(new Promise<null>((done) => { resolve = done; }));
    const first = checkForUpdates();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockCheck).toHaveBeenCalledOnce();
    const second = checkForUpdates();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockCheck).toHaveBeenCalledOnce();
    expect(getUpdateStatus()).toEqual({ state: "checking" });
    resolve(null);
    await Promise.all([first, second]);
    expect(getUpdateStatus()).toEqual({ state: "idle" });
  });

  it.each(["available", "downloading", "ready"] as const)("preserves %s during further checks", async (state) => {
    let finish!: () => void;
    const download = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    mockCheck.mockResolvedValue({ version: "2.0.0", body: "notes", downloadAndInstall: download });
    await checkForUpdates();
    let installation: Promise<void> | undefined;
    if (state !== "available") {
      installation = triggerManualUpdate();
      if (state === "ready") {
        finish();
        await installation;
      }
    }
    const before = getUpdateStatus();
    expect(before.state).toBe(state);
    mockCheck.mockResolvedValue(null);
    await checkForUpdates();
    expect(mockCheck).toHaveBeenCalledOnce();
    expect(getUpdateStatus()).toEqual(before);
    if (state === "downloading") {
      finish();
      await installation;
    }
  });

  it.each(["resolve", "reject"] as const)("waits for installation to %s after Finished bytes", async (outcome) => {
    let finish!: () => void;
    let fail!: (error: Error) => void;
    const download = vi.fn((onEvent: (event: { event: "Finished" }) => void) => {
      onEvent({ event: "Finished" });
      return new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    });
    mockCheck.mockResolvedValue({ version: "2.0.0", downloadAndInstall: download });
    await checkForUpdates();
    const installing = triggerManualUpdate();
    expect(getUpdateStatus().state).toBe("downloading");
    const { trackEvent } = await import("../../lib/analytics");
    expect(trackEvent).not.toHaveBeenCalledWith("update_downloaded", expect.anything());
    await triggerManualUpdate();
    expect(download).toHaveBeenCalledOnce();
    if (outcome === "resolve") finish();
    else fail(new Error("signature verification failed"));
    await installing;
    expect(getUpdateStatus()).toEqual(outcome === "resolve"
      ? { state: "ready", version: "2.0.0" }
      : { state: "error", message: "signature verification failed" });
    expect(mockRelaunch).not.toHaveBeenCalled();
    if (outcome === "resolve") {
      expect(trackEvent).toHaveBeenCalledWith("update_downloaded", { version: "2.0.0" });
    } else {
      expect(trackEvent).not.toHaveBeenCalledWith("update_downloaded", expect.anything());
    }
  });

  it.each([false, true])("retains the explicit autoUpdate=%s choice without restarting", async (autoUpdate) => {
    mockSettings.autoUpdate = autoUpdate;
    const download = vi.fn().mockResolvedValue(undefined);
    mockCheck.mockResolvedValue({ version: "2.0.0", downloadAndInstall: download });
    await checkForUpdates();
    expect(download).toHaveBeenCalledTimes(autoUpdate ? 1 : 0);
    expect(getUpdateStatus().state).toBe(autoUpdate ? "ready" : "available");
    expect(mockSettings.autoUpdate).toBe(autoUpdate);
    expect(mockRelaunch).not.toHaveBeenCalled();
  });

  it("does not duplicate installation when an available listener requests a manual update", async () => {
    mockSettings.autoUpdate = true;
    let finish!: () => void;
    const download = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    mockCheck.mockResolvedValue({ version: "2.0.0", downloadAndInstall: download });
    let manual: Promise<void> | undefined;
    onUpdateStatus((status) => {
      if (status.state === "available") manual = triggerManualUpdate();
    });
    const checking = checkForUpdates();
    await vi.waitFor(() => expect(download).toHaveBeenCalled());
    expect(download).toHaveBeenCalledOnce();
    finish();
    await Promise.all([checking, manual]);
    expect(getUpdateStatus()).toEqual({ state: "ready", version: "2.0.0" });
  });

  beforeEach(async () => {
    mockSettings.autoUpdate = false;
    vi.spyOn(document, "addEventListener");
    vi.resetModules();
    vi.clearAllMocks();
    mockCheck.mockResolvedValue(null);
    ({ onUpdateStatus, checkForUpdates, getUpdateStatus, triggerManualUpdate,
      installAndRestart, initUpdater } = await import("../../features/updater"));
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
