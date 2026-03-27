import { useState, memo } from "react";
import { useStore } from "../core/store";
import { useT } from "../i18n/i18n";
import { modLabel } from "../lib/platform";
import { trackEvent } from "../lib/analytics";
import InlineRename from "../shared/InlineRename";

interface Props {
  onNewProject: () => void;
  onCommandPalette: () => void;
}

export default memo(function TabBar({ onNewProject, onCommandPalette }: Props) {
  const t = useT();
  const projects = useStore((s) => s.projects);
  const activePid = useStore((s) => s.activePid);
  const notifiedSessions = useStore((s) => s.notifiedSessions);
  const setActiveProject = useStore((s) => s.setActiveProject);
  const removeProject = useStore((s) => s.removeProject);
  const renameProject = useStore((s) => s.renameProject);
  const clearNotification = useStore((s) => s.clearNotification);
  const [renamingTab, setRenamingTab] = useState<string | null>(null);

  return (
    <div className="tab-bar">
      <img src="/orbit-logo.png" className="tab-bar__logo" alt="Orbit" />
      {projects.map((p) => {
        const projectNotified = p.sessions.some((s) => notifiedSessions[s.id]);
        return (
          <div
            key={p.id}
            role="button"
            tabIndex={0}
            className={`tab ${p.id === activePid ? "tab--active" : ""} ${projectNotified ? "tab--notified" : ""}`}
            onClick={() => {
              setActiveProject(p.id);
              trackEvent("project_switched");
              if (projectNotified) {
                p.sessions.forEach((s) => clearNotification(s.id));
              }
            }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveProject(p.id); } }}
            onDoubleClick={() => setRenamingTab(p.id)}
          >
            {renamingTab === p.id ? (
              <InlineRename
                value={p.name}
                onConfirm={(v) => { renameProject(p.id, v); setRenamingTab(null); trackEvent("project_renamed"); }}
                onCancel={() => setRenamingTab(null)}
              />
            ) : (
              <>
                {projectNotified && <span className="tab__badge" />}
                {p.name}
              </>
            )}
            {projects.length > 1 && (
              <span
                role="button"
                tabIndex={0}
                className="tab__close"
                onClick={(e) => { e.stopPropagation(); removeProject(p.id); trackEvent("project_deleted"); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); removeProject(p.id); } }}
              >
                &times;
              </span>
            )}
          </div>
        );
      })}
      <button className="tab-bar__btn" title={`${t("tabbar.newProject")} (${modLabel}+Shift+N)`} aria-label={t("tabbar.newProject")} onClick={onNewProject}>+</button>
      <div className="tab-bar__spacer" />
      <button className="tab-bar__btn" title={`${t("tabbar.bookmarks")} (${modLabel}+P)`} aria-label={t("tabbar.bookmarks")} onClick={onCommandPalette}>&#x2606;</button>
    </div>
  );
});
