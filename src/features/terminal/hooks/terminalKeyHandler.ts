import type { Terminal as XTerm } from "@xterm/xterm";

export type JumpDirection = "prev" | "next";

export type TerminalKeyHandlerDeps = {
  /** Reserved for Windows clipboard branches (Task 4/5); current handler doesn't read it. */
  sid: string;
  /** Reserved for Windows clipboard branches (Task 4/5); current handler doesn't read it. */
  term: Pick<XTerm, "hasSelection" | "getSelection" | "clearSelection">;
  /** Reserved for Windows clipboard branches (Task 4/5); current handler doesn't read it. */
  pty: { write: (sid: string, data: string) => Promise<void> | void };
  /** Called with the direction to navigate between Claude Code prompts in the scrollback. */
  jumpPrompt: (dir: JumpDirection) => void;
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
  const { jumpPrompt } = deps;

  return (e: KeyboardEvent): boolean => {
    // Prompt navigation: Cmd/Ctrl + ArrowUp/ArrowDown
    if ((e.metaKey || e.ctrlKey) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      e.stopPropagation();
      jumpPrompt(e.key === "ArrowUp" ? "prev" : "next");
      return false;
    }
    return true;
  };
}
