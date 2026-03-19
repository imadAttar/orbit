import { useEffect } from "react";
import { useStore } from "../core/store";
import { claude, statusline, listen } from "../core/api";
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
      try {
        const installed = await claude.isInstalled();
        if (!installed) {
          dispatch({ type: "set", field: "showInstallClaude", value: true });
          return;
        }
      } catch {
        /* not in Tauri */
      }
      if (!s.statuslineAsked && !isWindows) {
        try {
          const has = await statusline.has();
          if (!has) dispatch({ type: "set", field: "showStatuslinePrompt", value: true });
          else useStore.getState().setStatuslineAsked();
        } catch {
          /* not in Tauri */
        }
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
}
