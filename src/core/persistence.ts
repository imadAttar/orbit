/**
 * Persistence layer for Orbit.
 * Handles load/save of app state with 3-level fallback:
 *   1. Rust command (TCC-immune on macOS)
 *   2. Tauri FS plugin
 *   3. Legacy directory migration
 *
 * Extracted from store.ts for testability and separation of concerns.
 */

import { orbit } from "./api";
import { logger } from "../lib/logger";
import type { Project, Settings } from "./types";

const DATA_DIR = ".orbit";
const DATA_FILE = "data.json";
const LEGACY_DIR = ".claude-ide";

interface PersistedData {
  projects: Project[];
  activePid: string;
  activeSid: string;
  settings: Settings;
  projectSessions?: Record<string, string>; // optional for legacy data
}

interface SaveState {
  queue: Promise<void>;
  timeout: ReturnType<typeof setTimeout> | null;
}
const devRuntime = globalThis as typeof globalThis & { __orbitPersistence?: SaveState };
// Retain mutable ownership, not a copied promise: old and refreshed closures
// must append to the same queue while native writes are still in flight.
const saveState = (import.meta.env.DEV && devRuntime.__orbitPersistence)
  || { queue: Promise.resolve(), timeout: null };
if (import.meta.env.DEV) devRuntime.__orbitPersistence = saveState;

function isPersistedData(data: unknown): data is PersistedData {
  if (!data || typeof data !== "object" || !("projects" in data)) return false;
  return Array.isArray(data.projects) && data.projects.every((p) => p && typeof p.id === "string"
    && Array.isArray(p.sessions) && p.sessions.every((s: unknown) => s && typeof s === "object"
      && "id" in s && typeof s.id === "string"));
}

async function getTauriFs() {
  try {
    return await import("@tauri-apps/plugin-fs");
  } catch {
    return null;
  }
}

export async function loadData(): Promise<PersistedData | null> {
  // Primary: Rust command (TCC-immune)
  try {
    const raw = await orbit.readFile(DATA_FILE);
    const data = JSON.parse(raw);
    if (isPersistedData(data)) return data;
  } catch { /* not found via Rust */ }

  // Fallback: Tauri FS plugin
  try {
    const fs = await getTauriFs();
    if (fs) {
      const raw = await fs.readTextFile(`${DATA_DIR}/${DATA_FILE}`, {
        baseDir: fs.BaseDirectory.Home,
      });
      const data = JSON.parse(raw);
      if (isPersistedData(data)) return data;
    }
  } catch { /* not found via plugin */ }

  // Migrate from legacy dir
  try {
    const fs = await getTauriFs();
    if (fs) {
      const raw = await fs.readTextFile(`${LEGACY_DIR}/${DATA_FILE}`, {
        baseDir: fs.BaseDirectory.Home,
      });
      const data = JSON.parse(raw);
      if (isPersistedData(data)) {
        await orbit.writeFile(DATA_FILE, raw);
        logger.info("persistence", "Migrated data from legacy directory");
        return data as PersistedData;
      }
    }
  } catch { /* no legacy data */ }

  return null;
}

async function saveData(data: PersistedData): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  // Primary: Rust command
  try {
    await orbit.writeFile(DATA_FILE, json);
    return;
  } catch { /* Rust not available */ }
  // Fallback: Tauri FS plugin
  const fs = await getTauriFs();
  if (!fs) return;
  try {
    await fs.mkdir(DATA_DIR, { baseDir: fs.BaseDirectory.Home, recursive: true });
  } catch { /* exists */ }
  const temporary = `${DATA_DIR}/.data-${crypto.randomUUID()}.tmp`;
  // Exclusive creation establishes ownership before any bytes are written.
  // If creation fails, a preexisting file must not be removed.
  const file = await fs.open(temporary, { baseDir: fs.BaseDirectory.Home, write: true, createNew: true });
  try {
    try {
      const bytes = new TextEncoder().encode(json);
      let offset = 0;
      while (offset < bytes.length) {
        const written = await file.write(bytes.subarray(offset));
        if (written === 0) throw new Error("Ecriture interrompue sans progression");
        offset += written;
      }
    } finally {
      await file.close();
    }
    await fs.rename(temporary, `${DATA_DIR}/${DATA_FILE}`, {
      oldPathBaseDir: fs.BaseDirectory.Home,
      newPathBaseDir: fs.BaseDirectory.Home,
    });
  } finally {
    // Close before publication/cleanup, including on Windows; never remove data.json.
    await fs.remove(temporary, { baseDir: fs.BaseDirectory.Home }).catch(() => {});
  }
}

export function debouncedSave(data: PersistedData): void {
  if (saveState.timeout !== null) clearTimeout(saveState.timeout);
  saveState.timeout = setTimeout(() => {
    saveState.timeout = null;
    saveState.queue = saveState.queue.then(() => saveData(data))
      .catch(() => logger.error("persistence", "Impossible de sauvegarder les donnees Orbit"));
  }, 300);
}
