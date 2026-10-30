import { useState, useMemo, useEffect, useCallback, memo } from "react";
import type { Session } from "../core/types";
import { useStore } from "../core/store";
import { trackEvent } from "../lib/analytics";
import { useT } from "../i18n/i18n";
import InlineRename from "../shared/InlineRename";
import ActivityPanel from "../features/activity/ActivityPanel";
import NavigationIcon from "./NavigationIcon";
import { modLabel } from "../lib/platform";
import { needsAttention, observeSession } from "../core/supervision";

interface Props {
  onSupervision?: () => void;
  onSessionOpen?: () => void;
  supervisionOpen?: boolean;
  onContextMenu: (sid: string, x: number, y: number) => void;
  onNewProject?: () => void;
  onPreferences?: () => void;
}

export default function Sidebar({ onContextMenu, onNewProject, onPreferences, onSupervision, onSessionOpen, supervisionOpen = false }: Props) {
  const t = useT();
  const [view, setView] = useState<"sessions" | "activity" | "archives">("sessions");

  const projects = useStore((s) => s.projects);
  const activePid = useStore((s) => s.activePid);
  const activeSid = useStore((s) => s.activeSid);
  const sidebarWidth = useStore((s) => s.settings.sidebarWidth);
  const setActiveSession = useStore((s) => s.setActiveSession);
  const renameSession = useStore((s) => s.renameSession);
  const addSession = useStore((s) => s.addSession);
  const setActiveProject = useStore((s) => s.setActiveProject);
  const renameProject = useStore((s) => s.renameProject);
  const removeProject = useStore((s) => s.removeProject);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [renamingProject, setRenamingProject] = useState<string | null>(null);
  const [projectMenu, setProjectMenu] = useState<string | null>(null);
  const [deleteProject, setDeleteProject] = useState<string | null>(null);
  const attentionCount = useStore((s) => s.projects.reduce((count, p) => count + p.sessions.filter((ss) => ss.archivedAt === undefined && needsAttention(observeSession(ss, s.sessionStates, ss.claudeSessionId ? s.sessionSubagents[ss.claudeSessionId] : []))).length, 0));

  const [renamingSession, setRenamingSession] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  useEffect(() => { setView("sessions"); }, [activeSid]);

  // Listen for rename-session event from context menu
  useEffect(() => {
    const handler = (e: Event) => {
      const sid = (e as CustomEvent).detail?.sessionId;
      if (!sid) return;
      setView("sessions");
      setQuery("");
      setRenamingSession(sid);
      const project = useStore.getState().projects.find((p) => p.sessions.some((s) => s.id === sid));
      if (project) {
        setCollapsed((prev) => { const next = new Set(prev); next.delete(project.id); return next; });
        setExpanded((prev) => new Set(prev).add(project.id));
      }
    };
    window.addEventListener("rename-session", handler);
    return () => window.removeEventListener("rename-session", handler);
  }, []);

  const sidebarStyle = useMemo(() => ({ width: Math.max(280, Math.min(400, sidebarWidth)) }), [sidebarWidth]);
  const search = query.trim().toLocaleLowerCase();
  const matches = (projectName: string, session: Session) => !search || `${projectName} ${session.name}`.toLocaleLowerCase().includes(search);
  const pinned = projects.flatMap((p) => p.sessions.filter((s) => s.archivedAt === undefined && s.pinned && matches(p.name, s)).map((session) => ({ project: p, session })));
  const toggle = (update: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => update((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const handleSessionClick = useCallback((sid: string) => {
    onSessionOpen?.();
    if (sid !== useStore.getState().activeSid) { setActiveSession(sid); trackEvent("session_switched"); }
    setView("sessions");
  }, [setActiveSession, onSessionOpen]);

  const handleDrop = useCallback((e: React.DragEvent, targetSid: string) => {
    e.preventDefault();
    setDragOverId(null);
    const fromId = e.dataTransfer.getData("text/plain");
    if (fromId && fromId !== targetSid) {
      useStore.getState().reorderSession(fromId, targetSid);
      trackEvent("session_reordered");
    }
  }, []);

  const renderSession = (s: Session, idx: number, pinnedCopy = false) => <SessionItem key={s.id} session={s} idx={idx}
    isActive={s.id === activeSid} isDragOver={!pinnedCopy && dragOverId === s.id} isRenaming={!pinnedCopy && renamingSession === s.id}
    onClick={handleSessionClick} onDragOver={setDragOverId} onDrop={handleDrop} onRename={renameSession}
    onRenameStart={setRenamingSession} onRenameCancel={() => setRenamingSession(null)} onContextMenu={onContextMenu} />;

  if (!projects.length) return null;

  return (
    <aside className="sidebar" style={sidebarStyle} data-testid="sidebar" aria-label={t("sidebar.views")}>
      <div className="sidebar__brand"><img src="/orbit-logo.png" alt="" /><strong>Orbit</strong><span>{t("sidebar.workspace")}</span></div>
      <div className="sidebar__primary">
        {onSupervision && <button className="sidebar__nav" aria-pressed={supervisionOpen} onClick={onSupervision}><NavigationIcon kind="sessions" />{t("supervision.title")}</button>}
        <button data-testid="add-claude-session" className="sidebar__nav" onClick={() => { addSession(); setView("sessions"); trackEvent("session_created"); }}><NavigationIcon kind="plus" />{t("shortcuts.newSession")}<kbd aria-hidden="true">{modLabel} N</kbd></button>
        <button className="sidebar__nav" aria-pressed={view === "activity"} onClick={() => setView("activity")}><NavigationIcon kind="attention" />{t("sidebar.attention")}{attentionCount > 0 && <span className="sidebar__badge" aria-hidden="true">{attentionCount}</span>}</button>
      </div>
      <div className="sidebar__scroll">
      {view !== "sessions" ? <ActivityPanel key={view} archives={view === "archives"} /> : <>
        <label className="sidebar__search"><NavigationIcon kind="search" /><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("common.search")} aria-label={t("activity.search")} /></label>
        <section aria-label={t("sidebar.pinned")}>
          <h2 className="sidebar__section-label">{t("sidebar.pinned")}</h2>
          {pinned.length ? pinned.map(({ project, session }) => <div key={session.id} title={project.name}>{renderSession(session, -1, true)}</div>) : <p className="sidebar__empty">{t(search ? "sidebar.noPinnedMatch" : "sidebar.pinHint")}</p>}
        </section>
        <section aria-label={t("sidebar.projects")}>
          <div className="sidebar__section-heading"><h2 className="sidebar__section-label">{t("sidebar.projects")}</h2><button className="sidebar__icon-button" onClick={onNewProject} aria-label={t("tabbar.newProject")}><NavigationIcon kind="plus" /></button></div>
          {projects.map((p) => {
            const visible = p.sessions.filter((s) => s.archivedAt === undefined);
            const ordered = [...visible.filter((s) => s.type !== "terminal"), ...visible.filter((s) => s.type === "terminal")];
            const filtered = ordered.filter((s) => matches(p.name, s));
            if (search && !filtered.length) return null;
            const open = !!search || !collapsed.has(p.id);
            const shown = search || expanded.has(p.id) ? filtered : filtered.filter((s, i) => i < 3 || s.id === activeSid || s.unread || s.runtimeStatus === "failed" || (s.claudeSessionId && useStore.getState().sessionStates[s.claudeSessionId] === "waiting"));
            return <section key={p.id} className={`sidebar__project ${p.id === activePid ? "sidebar__project--active" : ""}`} aria-label={p.name}>
              <div className="sidebar__project-header">
                <button className="sidebar__collapse" aria-label={t(open ? "sidebar.collapse" : "sidebar.expand", { name: p.name })} aria-expanded={open} onClick={() => toggle(setCollapsed, p.id)}><NavigationIcon kind="chevron" /></button>
                {renamingProject === p.id ? <InlineRename value={p.name} onConfirm={(name) => { renameProject(p.id, name); setRenamingProject(null); }} onCancel={() => setRenamingProject(null)} /> : <button className="sidebar__project-name" onClick={() => { setActiveProject(p.id); setCollapsed((prev) => { const next = new Set(prev); next.delete(p.id); return next; }); trackEvent("project_switched"); }} onDoubleClick={() => setRenamingProject(p.id)} title={p.dir}><NavigationIcon kind="folder" /><span>{p.name}</span><small>{visible.length}</small></button>}
                <button className="sidebar__icon-button sidebar__project-menu" aria-label={t("sidebar.projectActions", { name: p.name })} aria-expanded={projectMenu === p.id} onClick={() => setProjectMenu(projectMenu === p.id ? null : p.id)}><NavigationIcon kind="more" /></button>
              </div>
              {projectMenu === p.id && <div className="sidebar__project-actions" role="group" aria-label={t("sidebar.projectActions", { name: p.name })}>
                <button onClick={() => { setActiveProject(p.id); addSession(); setProjectMenu(null); }}>{t("shortcuts.newSession")}</button>
                <button onClick={() => { setActiveProject(p.id); addSession(undefined, "terminal"); setProjectMenu(null); }}>{t("shortcuts.newTerminal")}</button>
                <button onClick={() => { setRenamingProject(p.id); setProjectMenu(null); }}>{t("session.rename")}</button>
                {projects.length > 1 && <button className="sidebar__danger" onClick={() => { setDeleteProject(p.id); setProjectMenu(null); }}>{t("sidebar.removeProject")}</button>}
              </div>}
              {deleteProject === p.id && <div className="sidebar__project-confirm" role="group" aria-label={t("sidebar.removeProject")}><p>{t("sidebar.removeProjectConfirm", { name: p.name })}</p><button onClick={() => { removeProject(p.id); setDeleteProject(null); }}>{t("common.delete")}</button><button onClick={() => setDeleteProject(null)}>{t("common.cancel")}</button></div>}
              {open && <div className="sidebar__project-sessions">{shown.map((s) => renderSession(s, p.id === activePid ? ordered.indexOf(s) : -1))}
                {filtered.length > 3 && !search && <button className="sidebar__more" onClick={() => toggle(setExpanded, p.id)}>{t(expanded.has(p.id) ? "sidebar.showLess" : "sidebar.showAll", { count: filtered.length })}</button>}
              </div>}
            </section>;
          })}
          {search && !projects.some((p) => p.sessions.some((s) => s.archivedAt === undefined && matches(p.name, s))) && <p className="sidebar__empty" role="status">{t("activity.noMatches")}</p>}
        </section>
      </>}
      </div>
      <div className="sidebar__footer">
        <button aria-pressed={view === "sessions"} onClick={() => setView("sessions")}><NavigationIcon kind="folder" />{t("sidebar.sessions")}</button>
        <button aria-pressed={view === "archives"} onClick={() => setView("archives")}><NavigationIcon kind="archive" />{t("activity.archives")}</button>
        <button onClick={onPreferences} aria-label={t("prefs.title")} title={t("prefs.title")}><NavigationIcon kind="settings" /></button>
      </div>
    </aside>
  );
}

// --- SessionItem: memo-ised, with targeted store selectors ---

interface SessionItemProps {
  session: Session;
  idx: number;
  isActive: boolean;
  isDragOver: boolean;

  isRenaming: boolean;

  onClick: (sid: string) => void;
  onDragOver: (sid: string | null) => void;
  onDrop: (e: React.DragEvent, sid: string) => void;
  onRename: (sid: string, name: string) => void;
  onRenameStart: (sid: string) => void;
  onRenameCancel: () => void;

  onContextMenu: (sid: string, x: number, y: number) => void;
}

const SessionItem = memo(function SessionItem({
  session, idx, isActive, isDragOver, isRenaming,
  onClick, onDragOver, onDrop, onRename, onRenameStart, onRenameCancel, onContextMenu,
}: SessionItemProps) {
  const t = useT();
  const togglePinned = useStore((s) => s.toggleSessionPinned);
  // Targeted selectors — only re-render when THIS session's state/cost changes
  const dotClass = useStore((s) => observeSession(session, s.sessionStates, session.claudeSessionId ? s.sessionSubagents[session.claudeSessionId] : []));
  const cost = useStore((s) => s.sessionCosts[session.id]);
  const activityAt = session.lastActivityAt;
  const validDate = activityAt !== undefined && Number.isFinite(activityAt) && activityAt >= 0 && activityAt <= Date.now() && Number.isFinite(new Date(activityAt).getTime()) ? new Date(activityAt) : null;

  return (
    <div
      key={session.id}
      role="group"
      aria-label={session.name}
      data-testid="session-item"
      title={`${session.name} — ${t(`supervision.status.${dotClass}`)}`}
      className={`session-item ${isActive ? "session-item--active" : ""} ${isDragOver ? "session-item--drag-over" : ""}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", session.id)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(session.id); }}
      onDragLeave={() => onDragOver(null)}
      onDrop={(e) => onDrop(e, session.id)}
      onClick={() => onClick(session.id)}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(session.id); } }}
      onDoubleClick={(e) => { if (e.target instanceof Element && e.target.closest(".session-item__pin, .session-item__menu")) return; onRenameStart(session.id); }}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(session.id, e.clientX, e.clientY); }}
    >
      {session.type === "terminal" ? <span className="session-item__terminal" title={t("activity.terminal")}><NavigationIcon kind="terminal" /></span> : <span className={`session-item__dot session-item__dot--${dotClass}`} aria-label={t(`supervision.status.${dotClass}`)} />}
      {isRenaming ? (
        <InlineRename
          value={session.name}
          onConfirm={(v) => { onRename(session.id, v); onRenameCancel(); trackEvent("session_renamed"); }}
          onCancel={onRenameCancel}
        />
      ) : (
        <>
          <button className="session-item__open" aria-current={isActive ? "page" : undefined} aria-label={`${session.name} — ${t(`supervision.status.${dotClass}`)}`}><span className="session-item__name">{session.name}</span></button>
          <div className="session-item__meta">
            {cost !== undefined && (
              <span className="session-item__cost">${cost.toFixed(2)}</span>
            )}
            {validDate && <time className="session-item__time" dateTime={validDate.toISOString()} title={validDate.toLocaleString()}>{validDate.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</time>}
            {idx >= 0 && idx < 9 && <span className="session-item__index">{idx + 1}</span>}
            <button className={`session-item__pin ${session.pinned ? "session-item__pin--active" : ""}`} aria-label={t(session.pinned ? "sidebar.unpin" : "sidebar.pin", { name: session.name })} aria-pressed={!!session.pinned} onClick={(e) => { e.stopPropagation(); togglePinned(session.id); }}><NavigationIcon kind="pin" /></button>
            <button className="session-item__menu" aria-label={t("sidebar.sessionActions", { name: session.name })} onClick={(e) => { e.stopPropagation(); const box = e.currentTarget.getBoundingClientRect(); onContextMenu(session.id, box.right, box.bottom); }}><NavigationIcon kind="more" /></button>
          </div>
        </>
      )}
    </div>
  );
});
