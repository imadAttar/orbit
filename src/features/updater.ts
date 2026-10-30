import type { check } from "@tauri-apps/plugin-updater";
import { useStore } from "../core/store";
import { trackEvent } from "../lib/analytics";

type Update = NonNullable<Awaited<ReturnType<typeof check>>>;

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string; notes?: string }
  | { state: "downloading"; progress: number }
  | { state: "ready"; version: string }
  | { state: "error"; message: string };

let updateStatus: UpdateStatus = { state: "idle" };
const listeners = new Set<(s: UpdateStatus) => void>();
let pendingUpdate: Update | null = null;
let initialized = false;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
let lastCheckAt: number | null = null;

function notify(status: UpdateStatus) {
  updateStatus = status;
  listeners.forEach((fn) => fn(status));
}

export function onUpdateStatus(fn: (s: UpdateStatus) => void): () => void {
  listeners.add(fn);
  fn(updateStatus);
  return () => {
    listeners.delete(fn);
  };
}

export function getUpdateStatus(): UpdateStatus {
  return updateStatus;
}

export async function checkForUpdates(): Promise<void> {
  // Keep the discovered update and any in-flight check/install authoritative.
  if (updateStatus.state !== "idle" && updateStatus.state !== "error") return;
  lastCheckAt = Date.now();
  notify({ state: "checking" });

  try {
    const { check: checkUpdate } = await import("@tauri-apps/plugin-updater");
    const update = await checkUpdate();

    if (!update) {
      notify({ state: "idle" });
      return;
    }

    pendingUpdate = update;
    trackEvent("update_available", { version: update.version });

    notify({
      state: "available",
      version: update.version,
      notes: update.body ?? undefined,
    });

    const { autoUpdate } = useStore.getState().settings;
    if (autoUpdate) {
      await downloadAndInstall(update);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // No release published yet or network unavailable — stay silent
    if (msg.includes("Could not fetch") || msg.includes("404") || msg.includes("NetworkError")) {
      notify({ state: "idle" });
    } else {
      notify({ state: "error", message: msg });
    }
  }
}

async function downloadAndInstall(update: Update): Promise<void> {
  if (updateStatus.state === "downloading" || updateStatus.state === "ready") return;
  notify({ state: "downloading", progress: 0 });

  let totalSize = 0;
  let downloaded = 0;

  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        totalSize = (event.data as { contentLength?: number }).contentLength ?? 0;
      } else if (event.event === "Progress") {
        downloaded += (event.data as { chunkLength: number }).chunkLength;
        const progress = totalSize > 0 ? Math.round((downloaded / totalSize) * 100) : 0;
        notify({ state: "downloading", progress });
      }
    });

    // Finished only means the bytes arrived; signature verification and native
    // installation must also succeed before offering a restart.
    notify({ state: "ready", version: update.version });
    trackEvent("update_downloaded", { version: update.version });
  } catch (err) {
    notify({
      state: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function installAndRestart(): Promise<void> {
  try {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    trackEvent("update_installed");
    await relaunch();
  } catch (err) {
    notify({
      state: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function triggerManualUpdate(): Promise<void> {
  if (updateStatus.state === "available" && pendingUpdate) {
    await downloadAndInstall(pendingUpdate);
  } else if (updateStatus.state === "ready") {
    await installAndRestart();
  }
}

// Check on startup after a short delay
export function initUpdater(): void {
  // Local development must not query release infrastructure or install updates.
  // Explicit manual checks remain available; production startup is unchanged.
  if (import.meta.env.DEV || initialized) return;
  initialized = true;
  const checkIfDue = () => {
    if (lastCheckAt === null || Date.now() - lastCheckAt >= CHECK_INTERVAL_MS) {
      checkForUpdates().catch(() => {});
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && lastCheckAt !== null) {
      checkIfDue();
    }
  });
  setTimeout(() => {
    checkIfDue();
    setInterval(checkIfDue, CHECK_INTERVAL_MS);
  }, 5000);
}
