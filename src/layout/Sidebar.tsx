import { useState, useMemo } from "react";
import type { Project, Session } from "../core/types";
import { useStore } from "../core/store";
import { trackEvent } from "../lib/analytics";
import { useT } from "../i18n/i18n";
import InlineRename from "../shared/InlineRename";
import { useBookmarkFilter } from "../hooks/useBookmarkFilter";

interface Props {
  activeProject: Project;
  activeSid: string;
  notifiedSessions: Record<string, boolean>;
  sessionCosts: Record<string, number>;
  sidebarWidth: number;
  onSelectSession: (sid: string) => void;
  onClearNotification: (sid: string) => void;
  onRenameSession: (sid: string, name: string) => void;
  onAddSession: () => void;
  onContextMenu: (sid: string, x: number, y: number) => void;
  onOpenSkillSession: (name: string, command: string) => void;
  onOpenPromptCoach: () => void;
  onSendToSession: (prompt: string) => void;
}

export default function Sidebar({
  activeProject,
  activeSid,
  notifiedSessions,
  sessionCosts,
  sidebarWidth,
  onSelectSession,
  onClearNotification,
  onRenameSession,
  onAddSession,
  onContextMenu,
  onOpenSkillSession,
  onOpenPromptCoach,
  onSendToSession,
}: Props) {
  const t = useT();
  const { bookmarks, scores, maxScore } = useBookmarkFilter();
  const [renamingSession, setRenamingSession] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const sidebarStyle = useMemo(() => ({ width: sidebarWidth }), [sidebarWidth]);

  const bookmarkStyles = useMemo(() => {
    const map: Record<string, React.CSSProperties | undefined> = {};
    for (const b of bookmarks) {
      const score = scores[b.prompt] ?? 0;
      if (score > 0) {
        const intensity = 0.08 + (score / maxScore) * 0.2;
        map[b.id] = { background: `rgba(var(--accent-rgb), ${intensity})` };
      }
    }
    return map;
  }, [bookmarks, scores, maxScore]);

  return (
    <div className="sidebar" style={sidebarStyle}>
      <div className="sidebar__header">{t("session.sessions")}</div>
      <div className="sidebar__sessions">
        {activeProject.sessions.map((s: Session, idx: number) => (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            className={`session-item ${s.id === activeSid ? "session-item--active" : ""} ${dragOverId === s.id ? "session-item--drag-over" : ""} ${notifiedSessions[s.id] ? "session-item--notified" : ""}`}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/plain", s.id)}
            onDragOver={(e) => { e.preventDefault(); setDragOverId(s.id); }}
            onDragLeave={() => setDragOverId(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverId(null);
              const fromId = e.dataTransfer.getData("text/plain");
              if (fromId && fromId !== s.id) {
                useStore.getState().reorderSession(fromId, s.id);
                trackEvent("session_reordered");
              }
            }}
            onClick={() => { onSelectSession(s.id); onClearNotification(s.id); trackEvent("session_switched"); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectSession(s.id); onClearNotification(s.id); } }}
            onDoubleClick={() => setRenamingSession(s.id)}
            onContextMenu={(e) => { e.preventDefault(); onContextMenu(s.id, e.clientX, e.clientY); }}
          >
            <div className={`session-item__dot ${notifiedSessions[s.id] ? "session-item__dot--notified" : "session-item__dot--has-messages"}`} />
            {renamingSession === s.id ? (
              <InlineRename
                value={s.name}
                onConfirm={(v) => { onRenameSession(s.id, v); setRenamingSession(null); trackEvent("session_renamed"); }}
                onCancel={() => setRenamingSession(null)}
              />
            ) : (
              <>
                <span className="session-item__name">{s.name}</span>
                {notifiedSessions[s.id] && (
                  <span className="session-item__badge">{t("session.ready")}</span>
                )}
                <div className="session-item__meta">
                  {sessionCosts[s.id] !== undefined && (
                    <span className="session-item__cost">${sessionCosts[s.id].toFixed(2)}</span>
                  )}
                  {idx < 9 && <span className="session-item__index">{idx + 1}</span>}
                </div>
              </>
            )}
          </div>
        ))}
        <button className="sidebar__add-btn" onClick={onAddSession} aria-label={t("session.addSession")}>
          {t("session.addSession")}
        </button>
      </div>
      {bookmarks.length > 0 && (
        <div className="sidebar__skills sidebar__skills--project">
          <div className="sidebar__skills-label">{t("palette.projects")}</div>
          {bookmarks.map((b) => (
              <button
                key={b.id}
                className={`sidebar__skill-btn sidebar__skill-btn--project ${bookmarkStyles[b.id] ? "sidebar__skill-btn--scored" : ""}`}
                style={bookmarkStyles[b.id]}
                onClick={() => onSendToSession(b.prompt)}
              >
                {b.name}
                {b.description && <span className="sidebar__skill-tooltip">{b.description}</span>}
              </button>
          ))}
        </div>
      )}
      <div className="sidebar__skills">
        <div className="sidebar__skills-group">
          <div className="sidebar__skills-label">{t("skill.sectionDaily")}</div>
          <div className="sidebar__skills-row">
            <button className="sidebar__skill-btn" onClick={() => onOpenSkillSession(t("skill.standup"), "/standup")}>
              {t("skill.standup")}
              <span className="sidebar__skill-tooltip">{t("skill.standupDesc")}</span>
            </button>
            <button className="sidebar__skill-btn sidebar__skill-btn--accent" onClick={onOpenPromptCoach}>
              {t("skill.improvePrompt")}
              <span className="sidebar__skill-tooltip">{t("skill.improvePromptDesc")}</span>
            </button>
          </div>
        </div>
        <div className="sidebar__skills-group">
          <div className="sidebar__skills-label">{t("skill.sectionSetup")}</div>
          <div className="sidebar__skills-row">
            <button className="sidebar__skill-btn sidebar__skill-btn--setup" onClick={() => onOpenSkillSession(t("skill.configureProject"), "/bootstrap")}>
              {t("skill.configureProject")}
              <span className="sidebar__skill-tooltip">{t("skill.configureProjectDesc")}</span>
            </button>
            <button className="sidebar__skill-btn sidebar__skill-btn--setup" onClick={() => onOpenSkillSession(t("skill.optimizeAssistant"), "/coach")}>
              {t("skill.optimizeAssistant")}
              <span className="sidebar__skill-tooltip">{t("skill.optimizeAssistantDesc")}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
