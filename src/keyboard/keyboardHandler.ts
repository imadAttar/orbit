import { useStore } from "../core/store";
import { trackEvent } from "../lib/analytics";
import { hasAppModifier, isAppShortcut } from "../lib/shortcuts";

/**
 * Keyboard shortcut handler — extracted from App.tsx for testability.
 * Returns callbacks object so App.tsx can wire up React-specific state setters.
 */
export interface KeyboardCallbacks {
  showNewProject: () => void;
  confirmDeleteSession: (sid: string) => void;
  toggleSearch: () => void;
  showPreferences: () => void;
}

export function handleKeyboardShortcut(e: KeyboardEvent, callbacks: KeyboardCallbacks) {
  if (e.defaultPrevented || !isAppShortcut(e)) return;
  const target = e.target;
  if (target instanceof Element && !target.matches(".xterm-helper-textarea") &&
      target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
  const key = e.key.toLowerCase();
  if (e.repeat && !["=", "+", "-"].includes(key)) return;
  const mod = hasAppModifier(e);
  const state = useStore.getState();
  const project = state.projects.find((p) => p.id === state.activePid);
  const visible = project?.sessions.filter((s) => s.archivedAt === undefined) ?? [];
  const sessions = [...visible.filter((s) => s.type !== "terminal"), ...visible.filter((s) => s.type === "terminal")];

  if (mod && e.shiftKey && key === "n") {
    e.preventDefault();
    callbacks.showNewProject();
  } else if (mod && key === "n") {
    e.preventDefault();
    state.addSession();
    trackEvent("session_created");
  } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "t") {
    e.preventDefault();
    state.addSession(undefined, "terminal");
    trackEvent("terminal_session_created");
  } else if (mod && key === "w") {
    e.preventDefault();
    callbacks.confirmDeleteSession(state.activeSid);
  } else if (mod && key === "f") {
    e.preventDefault();
    callbacks.toggleSearch();
  } else if (mod && key === ",") {
    e.preventDefault();
    callbacks.showPreferences();
  } else if (mod && (e.key === "=" || e.key === "+")) {
    e.preventDefault();
    if (state.settings.fontSize < 20) state.setFontSize(state.settings.fontSize + 1);
  } else if (mod && e.key === "-") {
    e.preventDefault();
    if (state.settings.fontSize > 8) state.setFontSize(state.settings.fontSize - 1);
  } else if (e.ctrlKey && !e.metaKey && e.key >= "1" && e.key <= "9") {
    e.preventDefault();
    const idx = parseInt(e.key) - 1;
    if (idx < sessions.length) {
      state.setActiveSession(sessions[idx].id);
    }
  } else if (e.key === "Tab" && e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    if (sessions.length > 1) {
      const curIdx = sessions.findIndex((ss) => ss.id === state.activeSid);
      const next = e.shiftKey
        ? (curIdx - 1 + sessions.length) % sessions.length
        : (curIdx + 1) % sessions.length;
      state.setActiveSession(sessions[next].id);
    }
  }
}
