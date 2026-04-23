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
    shellOnly?: boolean;
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

  generateTitle: (prompt: string) =>
    call<string>("generate_title", { prompt }),

  generateSessionTitle: (transcriptPath: string) =>
    call<string>("generate_session_title", { transcriptPath }),

  enableSessionHooks: (projectDir: string) =>
    call<boolean>("enable_session_hooks", { projectDir }),

  checkSessionHooks: (projectDir: string) =>
    call<boolean>("check_session_hooks", { projectDir }),
};


// === Terminal ===

export const terminal = {
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

  collectCrashReport: (errorMessage: string) =>
    call<string>("collect_crash_report", { errorMessage }),
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
