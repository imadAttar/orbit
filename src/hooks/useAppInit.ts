import { useEffect } from "react";
import { useStore } from "../core/store";
import { pty, claude, statusline, listen } from "../core/api";
import { initAnalytics, trackEvent } from "../lib/analytics";
import { isWindows } from "../lib/platform";
import { initUpdater, onUpdateStatus } from "../features/updater";
import type { UpdateStatus } from "../features/updater";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useAppInit(dispatch: (action: any) => void) {
  const init = useStore((s) => s.init);

  useEffect(() => {
    init().then(async () => {
      const s = useStore.getState().settings;
      initAnalytics(s.analytics);
      const state = useStore.getState();
      trackEvent("app_launched", {
        theme: s.theme,
        fontSize: s.fontSize,
        projects: state.projects.length,
        sessions: state.projects.reduce((sum, p) => sum + p.sessions.length, 0),
        autoUpdate: s.autoUpdate ? 1 : 0,
      });
      initUpdater();
      // Auto-enable session hooks on all existing projects if setting is on
      if (s.autoNotifications) {
        for (const p of state.projects) {
          claude.enableSessionHooks(p.dir).catch(() => {});
        }
      }
      const checkInstalled = claude.isInstalled().catch(() => true);
      const checkStatusline = !s.statuslineAsked && !isWindows
        ? statusline.has().catch(() => true)
        : Promise.resolve(true);
      const [installed, hasStatusline] = await Promise.all([checkInstalled, checkStatusline]);
      if (!installed) {
        dispatch({ type: "set", field: "showInstallClaude", value: true });
        return;
      }
      if (!s.statuslineAsked && !isWindows) {
        if (!hasStatusline) dispatch({ type: "set", field: "showStatuslinePrompt", value: true });
        else useStore.getState().setStatuslineAsked();
      }
    });
  }, [init]);

  useEffect(
    () => onUpdateStatus((s: UpdateStatus) => dispatch({ type: "set", field: "updateStatus", value: s })),
    [],
  );

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<string>("menu-event", (payload) => {
      if (payload === "preferences") dispatch({ type: "set", field: "showPreferences", value: true });
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, []);

  // Track active usage time and session duration
  useEffect(() => {
    const appStart = Date.now();
    let lastFocusTime = Date.now();
    let lastEventTime = 0;
    const throttleMs = 2000;

    const onFocus = () => {
      const now = Date.now();
      if (now - lastEventTime < throttleMs) return;
      lastEventTime = now;
      lastFocusTime = now;
      trackEvent("window_focused");
    };
    const onBlur = () => {
      const now = Date.now();
      if (now - lastEventTime < throttleMs) return;
      lastEventTime = now;
      trackEvent("window_blurred", { activeMs: now - lastFocusTime });
    };
    const onBeforeUnload = () => {
      trackEvent("app_closed", { sessionDurationMs: Date.now() - appStart });
      // Kill all active PTYs to prevent orphaned Claude processes
      const state = useStore.getState();
      for (const p of state.projects) {
        for (const s of p.sessions) {
          pty.killSilent(s.id);
        }
      }
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);
}
