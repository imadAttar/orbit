/**
 * Structured logger for Orbit frontend.
 * Writes to the same log file as the Rust backend via a Tauri command.
 *
 * PRIVACY: Never log prompt content, session transcripts, or user input.
 * Only log: events, errors, state transitions, performance metrics.
 */

type InvokeFn = (cmd: string, args: Record<string, string>) => Promise<unknown>;
let invokeRef: InvokeFn | null = null;

async function getInvoke(): Promise<InvokeFn | null> {
  if (invokeRef) return invokeRef;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    invokeRef = (cmd, args) => invoke(cmd, args);
    return invokeRef;
  } catch {
    return null;
  }
}

function log(level: string, target: string, message: string) {
  // Fire and forget — logging should never block UI
  getInvoke().then((invoke) => {
    invoke?.("log_frontend", { level, target, message }).catch(() => {});
  });
}

export const logger = {
  error: (target: string, message: string) => log("error", target, message),
  warn: (target: string, message: string) => log("warn", target, message),
  info: (target: string, message: string) => log("info", target, message),
  debug: (target: string, message: string) => log("debug", target, message),
};
