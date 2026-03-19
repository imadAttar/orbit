import { useRef } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";

/**
 * Prompt navigation hook — jump between Claude Code prompts (❯ / >) in the terminal buffer.
 * Used with Cmd+Up/Down keyboard shortcuts and mini-nav buttons.
 */
export function usePromptNav(termRef: React.RefObject<XTerm | null>) {
  const promptIndexRef = useRef(-1);
  const jumpRef = useRef<(dir: "prev" | "next") => void>(() => {});

  const getPromptLines = (): number[] => {
    const term = termRef.current;
    if (!term) return [];
    const buf = term.buffer.active;
    const lines: number[] = [];
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (!line) continue;
      const text = line.translateToString(true);
      if (/^❯\s/.test(text) || /^>\s/.test(text)) {
        lines.push(i);
      }
    }
    return lines;
  };

  const jumpToPrompt = (direction: "prev" | "next") => {
    const term = termRef.current;
    if (!term) return;
    const prompts = getPromptLines();
    if (prompts.length === 0) return;

    const viewportTop = term.buffer.active.viewportY;

    if (direction === "prev") {
      let target = -1;
      for (let i = prompts.length - 1; i >= 0; i--) {
        if (prompts[i] < viewportTop) {
          target = i;
          break;
        }
      }
      if (target >= 0) {
        promptIndexRef.current = target;
        term.scrollToLine(Math.max(0, prompts[target]));
      }
    } else {
      const viewportBottom = viewportTop + term.rows;
      let target = -1;
      for (let i = 0; i < prompts.length; i++) {
        if (prompts[i] > viewportBottom) {
          target = i;
          break;
        }
      }
      if (target >= 0) {
        promptIndexRef.current = target;
        term.scrollToLine(Math.max(0, prompts[target]));
      } else {
        term.scrollToBottom();
      }
    }
  };

  // Keep ref in sync so the xterm key handler can call the latest jumpToPrompt
  jumpRef.current = jumpToPrompt;

  return { jumpToPrompt, jumpRef };
}
