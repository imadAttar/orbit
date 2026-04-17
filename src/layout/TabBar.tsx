import { useState, useEffect, useCallback, memo } from "react";
import { useStore } from "../core/store";
import { useT } from "../i18n/i18n";
import { modLabel } from "../lib/platform";
import { trackEvent } from "../lib/analytics";
import InlineRename from "../shared/InlineRename";

function useProjectState(projectId: string): "working" | "waiting" | "idle" | null {
  // Single selector — computes aggregated state, returns a primitive (no new refs)
  return useStore((s) => {
    const sessions = s.projects.find((p) => p.id === projectId)?.sessions;
    if (!sessions) return null;
    let hasIdle = false;
    for (const sess of sessions) {
      if (!sess.claudeSessionId) continue;
      const state = s.sessionStates[sess.claudeSessionId];
      if (state === "working") return "working";
      if (state === "waiting") return "waiting";
      if (state === "idle") hasIdle = true;
    }
    return hasIdle ? "idle" : null;
  });
}

interface Props {
  onNewProject: () => void;
}

export default memo(function TabBar({ onNewProject }: Props) {
  const t = useT();
  const projects = useStore((s) => s.projects);
  const activePid = useStore((s) => s.activePid);
  const setActiveProject = useStore((s) => s.setActiveProject);
  const removeProject = useStore((s) => s.removeProject);
  const renameProject = useStore((s) => s.renameProject);
  const [renamingTab, setRenamingTab] = useState<string | null>(null);
  const [flashingProjects, setFlashingProjects] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handler = (e: Event) => {
      const { projectId } = (e as CustomEvent).detail;
      if (!projectId) return;
      if (projectId === useStore.getState().activePid) return;
      setFlashingProjects((prev) => new Set(prev).add(projectId));
    };
    window.addEventListener("session-completed", handler);
    return () => window.removeEventListener("session-completed", handler);
  }, []);

  return (
    <div className="tab-bar">
      <img src="/orbit-logo.png" className="tab-bar__logo" alt="Orbit" />
      {projects.map((p) => (
        <TabItem
          key={p.id}
          projectId={p.id}
          name={p.name}
          isActive={p.id === activePid}
          isFlashing={flashingProjects.has(p.id)}
          isRenaming={renamingTab === p.id}
          showClose={projects.length > 1}
          onActivate={() => { setActiveProject(p.id); trackEvent("project_switched"); if (flashingProjects.has(p.id)) { trackEvent("notification_clicked"); setFlashingProjects((prev) => { const next = new Set(prev); next.delete(p.id); return next; }); } }}
          onDoubleClick={() => setRenamingTab(p.id)}
          onRename={(v) => { renameProject(p.id, v); setRenamingTab(null); trackEvent("project_renamed"); }}
          onCancelRename={() => setRenamingTab(null)}
          onClose={() => { removeProject(p.id); trackEvent("project_deleted"); }}
        />
      ))}
      <button className="tab-bar__btn" title={`${t("tabbar.newProject")} (${modLabel}+Shift+N)`} aria-label={t("tabbar.newProject")} onClick={onNewProject}>+</button>
      <div className="tab-bar__spacer" />
    </div>
  );
});

interface TabItemProps {
  projectId: string;
  name: string;
  isActive: boolean;
  isFlashing: boolean;
  isRenaming: boolean;
  showClose: boolean;
  onActivate: () => void;
  onDoubleClick: () => void;
  onRename: (v: string) => void;
  onCancelRename: () => void;
  onClose: () => void;
}

const TabItem = memo(function TabItem({
  projectId, name, isActive, isFlashing, isRenaming, showClose,
  onActivate, onDoubleClick, onRename, onCancelRename, onClose,
}: TabItemProps) {
  const aggregatedState = useProjectState(projectId);

  const indicatorClass = isFlashing
    ? "tab__indicator tab__indicator--unseen"
    : aggregatedState === "working"
      ? "tab__indicator tab__indicator--working"
      : "";

  const handleClose = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    onClose();
  }, [onClose]);

  return (
    <div
      role="button"
      tabIndex={0}
      className={`tab ${isActive ? "tab--active" : ""}`}
      onClick={onActivate}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onActivate(); } }}
      onDoubleClick={onDoubleClick}
    >
      {indicatorClass && <span className={indicatorClass} />}
      {isRenaming ? (
        <InlineRename value={name} onConfirm={onRename} onCancel={onCancelRename} />
      ) : (
        name
      )}
      {showClose && (
        <span
          role="button"
          tabIndex={0}
          className="tab__close"
          onClick={handleClose}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleClose(e); }}
        >
          &times;
        </span>
      )}
    </div>
  );
});
