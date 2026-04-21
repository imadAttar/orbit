import type { Terminal as XTerm } from "@xterm/xterm";
import { isWindows } from "../../../lib/platform";

export type JumpDirection = "prev" | "next";

export type TerminalKeyHandlerDeps = {
  /** Reserved for Windows clipboard branches (Task 4/5); current handler doesn't read it. */
  sid: string;
  /** xterm terminal instance used for selection queries and clipboard operations. */
  term: Pick<XTerm, "hasSelection" | "getSelection" | "clearSelection">;
  /** Reserved for Windows clipboard branches (Task 4/5); current handler doesn't read it. */
  pty: { write: (sid: string, data: string) => Promise<void> | void };
  /** Called with the direction to navigate between Claude Code prompts in the scrollback. */
  jumpPrompt: (dir: JumpDirection) => void;
  /** Tauri clipboard-manager writeText (Windows Ctrl+C copy branch). */
  writeText: (text: string) => Promise<void>;
  /** Tauri clipboard-manager readText (Windows Ctrl+V paste branch — Task 5). */
  readText: () => Promise<string | null>;
};

/**
 * Returns the handler wired to xterm's `attachCustomKeyEventHandler`.
 *
 * Return value semantics (xterm contract):
 *   - `false` → xterm does NOT process the event further (we handled it).
 *   - `true`  → xterm processes the event normally (we passed through).
 */
export function createTerminalKeyEventHandler(
  deps: TerminalKeyHandlerDeps,
): (e: KeyboardEvent) => boolean {
  const { sid, term, pty, jumpPrompt, writeText, readText } = deps;

  return (e: KeyboardEvent): boolean => {
    // Prompt navigation: Cmd/Ctrl + ArrowUp/ArrowDown
    if ((e.metaKey || e.ctrlKey) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      e.stopPropagation();
      jumpPrompt(e.key === "ArrowUp" ? "prev" : "next");
      return false;
    }

    // Windows: Ctrl+C with selection → copy, suppress SIGINT.
    // Only clean Ctrl+C — Shift/Alt/Meta modifiers pass through.
    if (
      isWindows &&
      e.ctrlKey &&
      !e.shiftKey &&
      !e.altKey &&
      !e.metaKey &&
      e.key === "c" &&
      term.hasSelection()
    ) {
      const text = term.getSelection();
      void writeText(text).catch((err: unknown) => {
        import("../../../lib/logger").then(({ logger }) =>
          logger.warn("clipboard", `writeText failed: ${err}`),
        );
      });
      term.clearSelection();
      return false;
    }

    // Windows: Ctrl+V → paste clipboard contents into the PTY. Clean modifiers only.
    if (
      isWindows &&
      e.ctrlKey &&
      !e.shiftKey &&
      !e.altKey &&
      !e.metaKey &&
      e.key === "v"
    ) {
      void (async () => {
        try {
          const text = await readText();
          if (text != null && text.length > 0) {
            await pty.write(sid, text);
          }
        } catch (err) {
          const { logger } = await import("../../../lib/logger");
          logger.warn("clipboard", `readText failed: ${err}`);
        }
      })();
      return false;
    }

    return true;
  };
}
