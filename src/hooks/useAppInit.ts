import { useEffect, useRef } from "react";
import { useStore } from "../core/store";
import { pty, claude, statusline, listen } from "../core/api";
import { initAnalytics, setAnalyticsEnabled, trackEvent } from "../lib/analytics";
import { isWindows } from "../lib/platform";
import { initUpdater, onUpdateStatus } from "../features/updater";
import type { UpdateStatus } from "../features/updater";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useAppInit(dispatch: (action: any) => void) {
  const init = useStore((s) => s.init);
  const initialization = useRef<{ action: typeof init; promise: Promise<void> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let consentReady = false;
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (consentReady && state.settings.analytics !== previous.settings.analytics) {
        setAnalyticsEnabled(state.settings.analytics);
      }
    });
    if (initialization.current?.action !== init) {
      initialization.current = { action: init, promise: useStore.getState().loaded ? Promise.resolve() : init() };
    }
    initialization.current.promise.then(async () => {
      if (cancelled) return;
      consentReady = true;
      const s = useStore.getState().settings;
      initAnalytics(s.analytics);
      const state = useStore.getState();
      const sessions = state.projects.flatMap((project) => project.sessions);
      trackEvent("app_launched", {
        theme: s.theme,
        fontSize: s.fontSize,
        projects: state.projects.length,
        sessions: sessions.length,
        agentSessions: sessions.filter((session) => session.type !== "terminal").length,
        terminalSessions: sessions.filter((session) => session.type === "terminal").length,
        defaultMode: s.defaultMode,
        autoUpdate: s.autoUpdate ? 1 : 0,
      });
      initUpdater();
      // Telemetry is independent of desktop notification preferences.
      for (const p of state.projects) {
        void state.enableProjectHooks(p.id);
      }
      const checkInstalled = claude.isInstalled().catch(() => true);
      const checkStatusline = !s.statuslineAsked && !isWindows
        ? statusline.has().catch(() => true)
        : Promise.resolve(true);
      const [installed, hasStatusline] = await Promise.all([checkInstalled, checkStatusline]);
      if (cancelled) return;
      if (!installed) {
        dispatch({ type: "set", field: "showInstallClaude", value: true });
        return;
      }
      if (!s.statuslineAsked && !isWindows) {
        if (!hasStatusline) dispatch({ type: "set", field: "showStatuslinePrompt", value: true });
        else useStore.getState().setStatuslineAsked();
      }
    }).catch(() => { /* initialization failed: leave analytics disabled */ });
    return () => { cancelled = true; unsubscribe(); };
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
    const appStart = performance.now();
    let lastFocusTime: number | null = document.hasFocus() ? appStart : null;
    let closed = false;

    const onFocus = () => {
      if (lastFocusTime !== null) return;
      lastFocusTime = performance.now();
      trackEvent("window_focused");
    };
    const onBlur = () => {
      if (lastFocusTime === null) return;
      const activeMs = Math.max(0, performance.now() - lastFocusTime);
      lastFocusTime = null;
      trackEvent("window_blurred", { activeMs });
    };
    const onBeforeUnload = () => {
      if (closed) return;
      closed = true;
      onBlur();
      trackEvent("app_closed", { sessionDurationMs: Math.max(0, performance.now() - appStart) });
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
