import { memo } from "react";
import { THEMES } from "../lib/themes";
import { useStore, selectActiveProject, selectActiveSession } from "../core/store";
import { observeSession } from "../core/supervision";
import { useT } from "../i18n/i18n";
export default memo(function StatusBar() {
  const t = useT();

  // Scalar selectors — stable refs, no unnecessary re-renders
  const activeProject = useStore(selectActiveProject);
  const activeSession = useStore(selectActiveSession);
  const activeCost = useStore((s) => s.sessionCosts[s.activeSid]);
  const theme = useStore((s) => s.settings.theme);
  const fontSize = useStore((s) => s.settings.fontSize);
  const claudeId = activeSession?.claudeSessionId;
  const sessionStateName = useStore((s) => activeSession ? observeSession(activeSession, s.sessionStates, claudeId ? s.sessionSubagents[claudeId] : []) : null);
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
            {t(`supervision.status.${sessionStateName}`)}{sessionStateName === "working" && sessionTool ? ` · ${sessionTool}` : ""}
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
      <span>{fontSize}px</span>
      <div className="status-bar__sep" />
      <span>{THEMES[theme]?.label}</span>
    </div>
  );
});
