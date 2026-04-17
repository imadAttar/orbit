import { useState, useRef, useMemo, useEffect, useCallback, memo } from "react";
import type { Session } from "../core/types";
import { useStore, selectActiveProject } from "../core/store";
import { trackEvent } from "../lib/analytics";
import { useT } from "../i18n/i18n";
import InlineRename from "../shared/InlineRename";

interface Props {
  onContextMenu: (sid: string, x: number, y: number) => void;
}

export default function Sidebar({ onContextMenu }: Props) {
  const t = useT();

  const activeProject = useStore(selectActiveProject);
  const activeSid = useStore((s) => s.activeSid);
  const sidebarWidth = useStore((s) => s.settings.sidebarWidth);
  const setActiveSession = useStore((s) => s.setActiveSession);
  const renameSession = useStore((s) => s.renameSession);
  const addSession = useStore((s) => s.addSession);
  const removeSession = useStore((s) => s.removeSession);

  const [renamingSession, setRenamingSession] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [flashingSessions, setFlashingSessions] = useState<Set<string>>(new Set());
  const flashingRef = useRef(flashingSessions);
  flashingRef.current = flashingSessions;

  // Listen for session completion — persistent until user clicks the session
  useEffect(() => {
    const handler = (e: Event) => {
      const { sessionId } = (e as CustomEvent).detail;
      if (!sessionId) return;
      if (sessionId === useStore.getState().activeSid) return;
      setFlashingSessions((prev) => new Set(prev).add(sessionId));
    };
    window.addEventListener("session-completed", handler);
    return () => window.removeEventListener("session-completed", handler);
  }, []);

  // Listen for rename-session event from context menu
  useEffect(() => {
    const handler = (e: Event) => {
      const sid = (e as CustomEvent).detail?.sessionId;
      if (sid) setRenamingSession(sid);
    };
    window.addEventListener("rename-session", handler);
    return () => window.removeEventListener("rename-session", handler);
  }, []);

  const sidebarStyle = useMemo(() => ({ width: sidebarWidth }), [sidebarWidth]);

  const claudeSessions = useMemo(() => activeProject?.sessions.filter((s) => s.type !== "terminal") ?? [], [activeProject?.sessions]);
  const terminalSessions = useMemo(() => activeProject?.sessions.filter((s) => s.type === "terminal") ?? [], [activeProject?.sessions]);
  const canDelete = true;

  const handleSessionClick = useCallback((sid: string) => {
    if (sid !== useStore.getState().activeSid) { setActiveSession(sid); trackEvent("session_switched"); }
    if (flashingRef.current.has(sid)) { setFlashingSessions((prev) => { const next = new Set(prev); next.delete(sid); return next; }); }
  }, [setActiveSession]);

  const handleDrop = useCallback((e: React.DragEvent, targetSid: string) => {
    e.preventDefault();
    setDragOverId(null);
    const fromId = e.dataTransfer.getData("text/plain");
    if (fromId && fromId !== targetSid) {
      useStore.getState().reorderSession(fromId, targetSid);
      trackEvent("session_reordered");
    }
  }, []);

  if (!activeProject?.sessions) return null;

  return (
    <div className="sidebar" style={sidebarStyle} data-testid="sidebar">
      <div className="sidebar__group">
        <div className="sidebar__group-header">
          <span>{t("session.sessions")}</span>
          <button data-testid="add-claude-session" className="sidebar__group-add" onClick={() => { addSession(); trackEvent("session_created"); }} aria-label={t("session.addClaudeSession")}>+</button>
        </div>
        <div className="sidebar__sessions">
          {claudeSessions.map((s, idx) => (
            <SessionItem
              key={s.id}
              session={s}
              idx={idx}
              isActive={s.id === activeSid}
              isDragOver={dragOverId === s.id}
              isFlashing={flashingSessions.has(s.id)}
              isRenaming={renamingSession === s.id}
              canDelete={canDelete}
              onClick={handleSessionClick}
              onDragOver={setDragOverId}
              onDrop={handleDrop}
              onRename={renameSession}
              onRenameStart={setRenamingSession}
              onRenameCancel={() => setRenamingSession(null)}
              onClose={removeSession}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      </div>
      {terminalSessions.length > 0 && (
        <div className="sidebar__group">
          <div className="sidebar__group-header">
            <span>Terminal</span>
            <button className="sidebar__group-add sidebar__group-add--terminal" onClick={() => { addSession(undefined, "terminal"); trackEvent("terminal_session_created"); }} aria-label={t("session.addTerminalSession")}>+</button>
          </div>
          <div className="sidebar__sessions">
            {terminalSessions.map((s, idx) => (
              <SessionItem
                key={s.id}
                session={s}
                idx={claudeSessions.length + idx}
                isActive={s.id === activeSid}
                isDragOver={dragOverId === s.id}
                isFlashing={flashingSessions.has(s.id)}
                isRenaming={renamingSession === s.id}
                canDelete={canDelete}
                onClick={handleSessionClick}
                onDragOver={setDragOverId}
                onDrop={handleDrop}
                onRename={renameSession}
                onRenameStart={setRenamingSession}
                onRenameCancel={() => setRenamingSession(null)}
                onClose={removeSession}
                onContextMenu={onContextMenu}
              />
            ))}
          </div>
        </div>
      )}
      {terminalSessions.length === 0 && (
        <div className="sidebar__group-header">
          <span>Terminal</span>
          <button className="sidebar__group-add sidebar__group-add--terminal" onClick={() => { addSession(undefined, "terminal"); trackEvent("terminal_session_created"); }} aria-label={t("session.addTerminalSession")}>+</button>
        </div>
      )}
    </div>
  );
}

// --- SessionItem: memo-ised, with targeted store selectors ---

interface SessionItemProps {
  session: Session;
  idx: number;
  isActive: boolean;
  isDragOver: boolean;
  isFlashing: boolean;
  isRenaming: boolean;
  canDelete: boolean;
  onClick: (sid: string) => void;
  onDragOver: (sid: string | null) => void;
  onDrop: (e: React.DragEvent, sid: string) => void;
  onRename: (sid: string, name: string) => void;
  onRenameStart: (sid: string) => void;
  onRenameCancel: () => void;
  onClose: (sid: string) => void;
  onContextMenu: (sid: string, x: number, y: number) => void;
}

const SessionItem = memo(function SessionItem({
  session, idx, isActive, isDragOver, isFlashing, isRenaming, canDelete,
  onClick, onDragOver, onDrop, onRename, onRenameStart, onRenameCancel, onClose, onContextMenu,
}: SessionItemProps) {
  const closingRef = useRef(false);
  // Targeted selectors — only re-render when THIS session's state/cost changes
  const dotClass = useStore((s) => {
    if (session.type === "terminal") return "";
    if (isFlashing) return "session-item__dot--unseen";
    if (!session.claudeSessionId) return "";
    const state = s.sessionStates[session.claudeSessionId];
    if (state === "working") return "session-item__dot--working";
    return "";
  });
  const cost = useStore((s) => s.sessionCosts[session.id]);

  return (
    <div
      key={session.id}
      role="button"
      tabIndex={0}
      data-testid="session-item"
      className={`session-item ${isActive ? "session-item--active" : ""} ${isDragOver ? "session-item--drag-over" : ""}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", session.id)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(session.id); }}
      onDragLeave={() => onDragOver(null)}
      onDrop={(e) => onDrop(e, session.id)}
      onClick={() => onClick(session.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(session.id); } }}
      onDoubleClick={() => onRenameStart(session.id)}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(session.id, e.clientX, e.clientY); }}
    >
      <div className={`session-item__dot ${dotClass}`} />
      {isRenaming ? (
        <InlineRename
          value={session.name}
          onConfirm={(v) => { onRename(session.id, v); onRenameCancel(); trackEvent("session_renamed"); }}
          onCancel={onRenameCancel}
        />
      ) : (
        <>
          <span className="session-item__name">{session.name}</span>
          <div className="session-item__meta">
            {cost !== undefined && (
              <span className="session-item__cost">${cost.toFixed(2)}</span>
            )}
            {idx < 9 && <span className="session-item__index">{idx + 1}</span>}
            {canDelete && (
              <span
                role="button"
                tabIndex={0}
                className="session-item__close"
                onClick={(e) => { e.stopPropagation(); if (closingRef.current) return; closingRef.current = true; onClose(session.id); trackEvent("session_closed"); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); if (closingRef.current) return; closingRef.current = true; onClose(session.id); } }}
              >
                &times;
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
});
