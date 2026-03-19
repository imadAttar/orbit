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
import type { Project, Settings, Bookmark } from "./types";

const DATA_DIR = ".orbit";
const DATA_FILE = "data.json";
const LEGACY_DIR = ".claude-ide";

export interface PersistedData {
  projects: Project[];
  activePid: string;
  activeSid: string;
  settings: Settings;
  bookmarks?: Bookmark[];
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

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
    if (data?.projects?.length && data?.activePid) return data as PersistedData;
  } catch { /* not found via Rust */ }

  // Fallback: Tauri FS plugin
  try {
    const fs = await getTauriFs();
    if (fs) {
      const raw = await fs.readTextFile(`${DATA_DIR}/${DATA_FILE}`, {
        baseDir: fs.BaseDirectory.Home,
      });
      const data = JSON.parse(raw);
      if (data?.projects?.length && data?.activePid) return data as PersistedData;
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
      if (data?.projects?.length && data?.activePid) {
        await orbit.writeFile(DATA_FILE, raw);
        logger.info("persistence", "Migrated data from legacy directory");
        return data as PersistedData;
      }
    }
  } catch { /* no legacy data */ }

  return null;
}

export async function saveData(data: PersistedData): Promise<void> {
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
  await fs.writeTextFile(`${DATA_DIR}/${DATA_FILE}`, json, {
    baseDir: fs.BaseDirectory.Home,
  });
}

export function debouncedSave(data: PersistedData): void {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => saveData(data), 300);
}
