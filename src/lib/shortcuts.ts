import { isMac } from "./platform";

/** On macOS, Control belongs to the terminal/Claude, not Orbit's Cmd actions. */
export function hasAppModifier(e: KeyboardEvent): boolean {
  return e.metaKey ? !e.ctrlKey : !isMac && e.ctrlKey;
}

/** Shared by the app and xterm: reserve only shortcuts Orbit really handles. */
export function isAppShortcut(e: KeyboardEvent): boolean {
  if (e.altKey || e.isComposing) return false;
  const key = e.key.toLowerCase();
  if (e.ctrlKey && !e.metaKey && (key === "tab" || (!e.shiftKey && /^[1-9]$/.test(key)))) return true;
  if (hasAppModifier(e)) {
    if (key === "n" || key === "+" || key === "=") return true;
    return !e.shiftKey && ["t", "w", "f", ",", "-"].includes(key);
  }
  return false;
}
