import { memo } from "react";
import type { Project, Session } from "../core/types";
import { trackEvent } from "../lib/analytics";
import { THEMES } from "../lib/themes";
import { useStore } from "../core/store";
import { useT } from "../i18n/i18n";

interface Props {
  activeProject: Project;
  activeSession: Session;
  activeCost: number | undefined;
  isSplit: boolean;
  theme: string;
  fontSize: number;
}

export default memo(function StatusBar({ activeProject, activeSession, activeCost, isSplit, theme, fontSize }: Props) {
  const t = useT();
  const gitPending = useStore((s) => s.gitPending);
  const gitFiles = useStore((s) => s.gitFiles);
  const setShowGitPanel = useStore((s) => s.setShowGitPanel);

  // Structured session state from hooks
  const sessionState = useStore((s) => {
    const claudeId = activeSession.claudeSessionId;
    if (!claudeId) return null;
    const state = s.sessionStates[claudeId];
    if (!state) return null;
    return {
      state,
      tool: s.sessionTools[claudeId] || null,
      changedFiles: s.sessionChangedFiles[claudeId] || [],
    };
  });

  return (
    <div className="status-bar">
      <span>{activeProject.dir}</span>
      <div className="status-bar__sep" />
      <span>{activeSession.name}</span>
      {sessionState && (
        <>
          <div className="status-bar__sep" />
          <span className={`status-bar__state status-bar__state--${sessionState.state}`}>
            {sessionState.state === "working" && sessionState.tool
              ? sessionState.tool
              : sessionState.state}
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
      <span>{THEMES[theme as keyof typeof THEMES]?.label}</span>
    </div>
  );
});
