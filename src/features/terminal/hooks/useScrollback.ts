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

  useEffect(() => {
    if (!spawned) return;

    // Own this effect's instance: mutable refs may already point to its successor
    // (or be null) when cleanup runs. Never serialize that successor here.
    const term = termRef.current;
    const serialize = serializeRef.current;
    const doSave = () => {
      if (!term || !serialize) return;
      try {
        const data = serialize.serialize();
        // Empty/disposed terminals must not erase a previously persisted history.
        // Intentional history deletion belongs to scrollback.clear, not this hook.
        if (data) scrollback.save(sessionId, data);
      } catch (err) { import("../../../lib/logger").then(({ logger }) => logger.warn("scrollback", `serialize error: ${err}`)); }
    };
    saveRef.current = doSave;

    const interval = setInterval(doSave, 30000);
    window.addEventListener("beforeunload", doSave);

    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", doSave);
      doSave();
      if (saveRef.current === doSave) saveRef.current = () => {};
    };
  }, [spawned, sessionId, termRef, serializeRef]);

  return saveRef;
}
