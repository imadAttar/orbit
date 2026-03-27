import { memo } from "react";
import { trackEvent } from "../lib/analytics";
import { THEMES } from "../lib/themes";
import { useStore, selectActiveProject, selectActiveSession } from "../core/store";
import { useT } from "../i18n/i18n";

export default memo(function StatusBar() {
  const t = useT();

  // Scalar selectors — stable refs, no unnecessary re-renders
  const activeProject = useStore(selectActiveProject);
  const activeSession = useStore(selectActiveSession);
  const activeCost = useStore((s) => s.sessionCosts[s.activeSid]);
  const theme = useStore((s) => s.settings.theme);
  const fontSize = useStore((s) => s.settings.fontSize);
  const isSplit = useStore((s) => s.splitLayout.type !== "none");
  const gitPending = useStore((s) => s.gitPending);
  const gitFiles = useStore((s) => s.gitFiles);
  const setShowGitPanel = useStore((s) => s.setShowGitPanel);

  const claudeId = activeSession?.claudeSessionId;
  const sessionStateName = useStore((s) => claudeId ? s.sessionStates[claudeId] ?? null : null);
  const sessionTool = useStore((s) => claudeId ? s.sessionTools[claudeId] ?? null : null);

  if (!activeProject || !activeSession) return null;

  return (
    <div className="status-bar">
      <span>{activeProject.dir}</span>
      <div className="status-bar__sep" />
      <span>{activeSession.name}</span>
      {sessionStateName && (
        <>
          <div className="status-bar__sep" />
          <span className={`status-bar__state status-bar__state--${sessionStateName}`}>
            {sessionStateName === "working" && sessionTool
              ? sessionTool
              : sessionStateName}
          </span>
        </>
      )}
      {activeCost !== undefined && (
        <>
          <div className="status-bar__sep" />
          <span className="status-bar__cost">${activeCost.toFixed(2)}</span>
        </>
      )}
      <div className="status-bar__spacer" />
      {gitPending && (
        <button
          className="status-bar__git-btn status-bar__git-btn--pulse"
          onClick={() => { setShowGitPanel(true); trackEvent("git_panel_opened", { files: gitFiles.length }); }}
          title={t("git.pendingTooltip", { count: gitFiles.length })}
        >
          {t("git.pendingLabel", { count: gitFiles.length })}
        </button>
      )}
      {isSplit && <span className="status-bar__badge">{t("statusbar.split")}</span>}
      <span>{fontSize}px</span>
      <div className="status-bar__sep" />
      <span>{THEMES[theme]?.label}</span>
    </div>
  );
});
