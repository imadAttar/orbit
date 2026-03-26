import { useEffect, useRef } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { SerializeAddon } from "@xterm/addon-serialize";
import { scrollback } from "../../../core/api";

/**
 * Scrollback persistence hook.
 * Periodically serializes terminal content and saves via Rust backend.
 * Also saves on beforeunload for soft close.
 */
export function useScrollback(
  termRef: React.RefObject<XTerm | null>,
  serializeRef: React.RefObject<SerializeAddon | null>,
  sessionId: string,
  spawned: boolean,
) {
  const saveRef = useRef<() => void>(() => {});

  // Keep save function in sync with latest refs
  saveRef.current = () => {
    if (serializeRef.current && termRef.current) {
      try {
        const data = serializeRef.current.serialize();
        scrollback.save(sessionId, data);
      } catch (err) { import("../../../lib/logger").then(({ logger }) => logger.warn("scrollback", `serialize error: ${err}`)); }
    }
  };

  useEffect(() => {
    if (!spawned) return;

    const doSave = () => saveRef.current();

    const interval = setInterval(doSave, 30000);
    window.addEventListener("beforeunload", doSave);

    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", doSave);
      // Final save before cleanup
      doSave();
    };
  }, [spawned, sessionId]);

  return saveRef;
}
