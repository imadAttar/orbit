import { useEffect } from "react";
import { useStore } from "../core/store";
import { THEMES, applyChrome } from "../lib/themes";

/** Sync CSS custom properties when theme changes */
export function useThemeSync() {
  const theme = useStore((s) => s.settings.theme);
  useEffect(() => {
    const th = THEMES[theme];
    if (th) applyChrome(th);
  }, [theme]);
}
