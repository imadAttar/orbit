/**
 * Type-safe Tauri API wrapper for Orbit.
 * Centralizes all invoke() calls with proper types, error handling, and logging.
 *
 * PRIVACY: Never pass prompt content or user input through logging.
 */

import { logger } from "../lib/logger";

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let _invoke: InvokeFn | null = null;

async function getInvoke(): Promise<InvokeFn> {
  if (_invoke) return _invoke;
  const { invoke } = await import("@tauri-apps/api/core");
  _invoke = invoke;
  return _invoke;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = await getInvoke();
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    logger.error("api", `${cmd} failed: ${err}`);
    throw err;
  }
}

/** Fire-and-forget: call without waiting or error propagation */
function fire(cmd: string, args?: Record<string, unknown>): void {
  getInvoke().then((invoke) => invoke(cmd, args).catch(() => {}));
}

// === PTY Management ===

export const pty = {
  spawn: (args: {
    sessionId: string;
    projectDir: string;
    cols: number;
    rows: number;
    claudeSessionId?: string | null;
    resumeMode?: boolean;
    sessionName?: string | null;
    dangerousMode?: boolean;
  }) => call<void>("spawn_pty", args),

  write: (sessionId: string, data: string) =>
    call<void>("write_pty", { sessionId, data }),

  resize: (sessionId: string, cols: number, rows: number) =>
    call<void>("resize_pty", { sessionId, cols, rows }),

  kill: (sessionId: string) =>
    call<void>("kill_pty", { sessionId }),

  /** Fire-and-forget kill (cleanup, no error needed) */
  killSilent: (sessionId: string) =>
    fire("kill_pty", { sessionId }),
};

// === Claude Integration ===

export const claude = {
  isInstalled: () => call<boolean>("check_claude_installed"),

  install: () => call<string>("install_claude"),

  improvePrompt: (prompt: string) =>
    call<string>("improve_prompt", { prompt }),

  listSessions: (projectDir: string) =>
    call<string>("list_claude_sessions", { projectDir }),

  getSessionDir: (projectDir: string) =>
    call<string>("get_claude_session_dir", { projectDir }),

  deleteSession: (projectDir: string, sessionId: string) =>
    call<void>("delete_claude_session", { projectDir, sessionId }),
};

// === Git Operations ===

export const git = {
  status: (projectDir: string) =>
    call<string[]>("git_status", { projectDir }),

  diff: (projectDir: string) =>
    call<string>("git_diff", { projectDir }),

  diffFile: (projectDir: string, file: string) =>
    call<string>("git_diff_file", { projectDir, file }),

  commit: (projectDir: string, message: string) =>
    call<string>("git_commit", { projectDir, message }),

  push: (projectDir: string) =>
    call<string>("git_push", { projectDir }),

  changedFiles: (projectDir: string) =>
    call<{ status: string; file: string }[]>("git_changed_files", { projectDir }),
};

// === Terminal ===

export const terminal = {
  openExternal: (terminal: string, dir: string) =>
    call<void>("open_terminal", { terminal, dir }),

  openInEditor: (editor: string, path: string, line: number, projectDir: string) =>
    call<void>("open_in_editor", { editor, path, line, projectDir }),

  notifyDone: (sessionName: string) =>
    fire("notify_done", { sessionName }),
};

// === Scrollback ===

export const scrollback = {
  save: (sessionId: string, data: string) =>
    fire("save_scrollback", { sessionId, data }),

  load: (sessionId: string) =>
    call<string | null>("load_scrollback", { sessionId }),

  clear: (sessionId: string) =>
    fire("save_scrollback", { sessionId, data: "" }),
};

// === Orbit File I/O ===

export const orbit = {
  readFile: (name: string) =>
    call<string>("read_orbit_file", { name }),

  writeFile: (name: string, data: string) =>
    call<void>("write_orbit_file", { name, data }),

  createDirectory: (path: string) =>
    call<void>("create_directory", { path }),

  saveTempImage: (data: string, extension: string) =>
    call<string>("save_temp_image", { data, extension }),
};

// === Bookmarks & Skills ===

export const bookmarks = {
  scanSkills: (projectDir: string) =>
    call<{ name: string; prompt: string; description?: string }[]>("scan_project_skills", { projectDir }),

  score: (transcriptPath: string, lastMsg: string) =>
    call<Record<string, number>>("score_bookmarks", { transcriptPath, lastMsg }),

  installHooks: (projectDir: string) =>
    call<void>("install_orbit_hooks", { projectDir }),
};

// === Status Line ===

export const statusline = {
  has: () => call<boolean>("has_statusline"),
  create: () => call<void>("create_statusline"),
};

// === Event Listening ===

export async function listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  const { listen: tauriListen } = await import("@tauri-apps/api/event");
  return tauriListen<T>(event, (e) => handler(e.payload));
}
