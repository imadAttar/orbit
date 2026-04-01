import { useEffect } from "react";
import { useStore } from "../../../core/store";
import { scrollback } from "../../../core/api";
import type { Terminal as XTerm } from "@xterm/xterm";

interface RestoreConfig {
  sessionId: string;
  activated: boolean;
  generation: number;
  restoreChoice: "pending" | "ask" | "resume" | "fresh";
  modeChoice: "normal" | "yolo" | null;
  termRef: React.RefObject<XTerm | null>;
  spawnedRef: React.RefObject<boolean>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dp: (action: any) => void;
}

/**
 * Handles terminal session restore lifecycle:
 * - Lazy activation on first visibility
 * - Scrollback check to decide restore vs fresh
 * - Auto-resolve default mode after restore choice
 * - Session reset handler
 */
export function useTerminalRestore({
  sessionId,
  activated,
  generation,
  restoreChoice,
  modeChoice,
  termRef,
  spawnedRef,
  dp,
}: RestoreConfig) {
  // Check if scrollback exists — show prompt if yes, auto-start if no
  useEffect(() => {
    if (!activated) return;
    let cancelled = false;
    dp({ type: "setRestore", value: "pending" });
    (async () => {
      try {
        const data = await scrollback.load(sessionId);
        if (cancelled) return;
        if (data && data.length > 0) {
          dp({ type: "setRestore", value: "ask" });
        } else {
          dp({ type: "setRestore", value: "fresh" });
        }
      } catch (err) {
        if (cancelled) return;
        import("../../../lib/logger").then(({ logger }) => logger.warn("restore", `scrollback check failed: ${err}`));
        dp({ type: "setRestore", value: "fresh" });
      }
    })();
    return () => { cancelled = true; };
  }, [activated, sessionId, generation]);

  // Clear/reset handler
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.sessionId !== sessionId) return;
      // PTY kill handled by Rust spawn_pty (auto-kills previous for same session_id)
      scrollback.clear(sessionId);
      if (termRef.current) {
        termRef.current.clear();
        termRef.current.reset();
      }
      spawnedRef.current = false;
      useStore.getState().setClaudeSessionId(sessionId, "");
      dp({ type: "reset" });
    };
    window.addEventListener("reset-session", handler);
    return () => window.removeEventListener("reset-session", handler);
  }, [sessionId]);

  // After restore choice, resolve mode from default setting
  useEffect(() => {
    if (restoreChoice !== "resume" && restoreChoice !== "fresh") return;
    if (modeChoice !== null) return;
    const defaultMode = useStore.getState().settings.defaultMode;
    if (defaultMode) {
      dp({ type: "setMode", value: defaultMode });
    }
  }, [restoreChoice, modeChoice]);
}
