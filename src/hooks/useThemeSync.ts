import { useEffect, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import { useStore } from "../core/store";
import { THEMES, applyChrome, type AppTheme } from "../lib/themes";

/** Preferences preview/cancel is deliberately transient, not a store write.
 * Keep every mounted terminal (including hidden tabs) on that same palette.
 * Only xterm options change: never rewrite ANSI bytes, buffers or PTY state.
 */
export function useTerminalThemeSync(termRef: RefObject<Terminal | null>) {
  useEffect(() => {
    const update = (event: Event) => {
      const term = termRef.current;
      if (term) term.options.theme = (event as CustomEvent<AppTheme>).detail.terminal;
    };
    window.addEventListener("orbit:theme-applied", update);
    return () => window.removeEventListener("orbit:theme-applied", update);
  }, [termRef]);
}

/** Sync CSS custom properties when theme changes */
export function useThemeSync() {
  const theme = useStore((s) => s.settings.theme);
  useEffect(() => {
    const th = THEMES[theme];
    if (th) applyChrome(th);
  }, [theme]);
}
