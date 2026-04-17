import { useStore } from "../core/store";
import { trackEvent } from "../lib/analytics";

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
  const mod = e.metaKey || e.ctrlKey;
  const state = useStore.getState();

  if (mod && e.shiftKey && e.key === "n") {
    e.preventDefault();
    callbacks.showNewProject();
  } else if (mod && e.key === "n") {
    e.preventDefault();
    state.addSession();
    trackEvent("session_created");
  } else if (mod && e.key === "w") {
    e.preventDefault();
    callbacks.confirmDeleteSession(state.activeSid);
  } else if (mod && e.key === "f") {
    e.preventDefault();
    callbacks.toggleSearch();
  } else if (mod && e.key === ",") {
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
    const proj = state.projects.find((p) => p.id === state.activePid);
    if (proj && idx < proj.sessions.length) {
      state.setActiveSession(proj.sessions[idx].id);
    }
  } else if (e.key === "Tab" && e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    const proj = state.projects.find((p) => p.id === state.activePid);
    if (proj && proj.sessions.length > 1) {
      const curIdx = proj.sessions.findIndex((ss) => ss.id === state.activeSid);
      const next = e.shiftKey
        ? (curIdx - 1 + proj.sessions.length) % proj.sessions.length
        : (curIdx + 1) % proj.sessions.length;
      state.setActiveSession(proj.sessions[next].id);
    }
  }
}
