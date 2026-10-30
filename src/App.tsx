import { useReducer, useRef, useCallback, useEffect, useMemo, lazy, Suspense } from "react";
import { useStore, selectActiveProject, selectActiveSession } from "./core/store";
import { trackEvent } from "./lib/analytics";
import { useT } from "./i18n/i18n";

import ContextBar from "./layout/ContextBar";
import TerminalToolbar from "./layout/TerminalToolbar";
import PreviewIcon from "./features/preview/PreviewIcon";
import "./features/preview/preview.css";
import { usePreviewStore } from "./features/preview/previewStore";
import { EMPTY_PREVIEW } from "./features/preview/previewModel";
import ErrorBoundary from "./shared/ErrorBoundary";

import Sidebar from "./layout/Sidebar";
import SupervisionPanel from "./features/supervision/SupervisionPanel";
import SubagentRoster from "./features/supervision/SubagentRoster";
import FocusTrap from "./shared/FocusTrap";
import UpdateBanner from "./features/UpdateBanner";
import StatusBar from "./layout/StatusBar";
import { StatuslineModal, DeleteSessionModal, InstallClaudeModal } from "./modals/AppModals";
import { handleKeyboardShortcut } from "./keyboard/keyboardHandler";
import type { UpdateStatus } from "./features/updater";
import { useAppInit } from "./hooks/useAppInit";
import { useThemeSync } from "./hooks/useThemeSync";

// Lazy-loaded heavy components (code-split)
const TerminalView = lazy(() => import("./features/terminal/Terminal"));
const NewProjectModal = lazy(() => import("./modals/NewProjectModal"));
const PreferencesModal = lazy(() => import("./modals/PreferencesModal"));
const PreviewPane = lazy(() => import("./features/preview/PreviewPane"));

// --- UI State ---

interface UIState {
  showSupervision: boolean;
  showNewProject: boolean;
  showPreferences: boolean;
  confirmDeleteSession: string | null;
  searchOpen: boolean;
  showStatuslinePrompt: boolean;
  showInstallClaude: boolean;
  contextMenu: { sid: string; x: number; y: number } | null;
  updateStatus: UpdateStatus;
  prevActivePid: string;
}

type UIAction =
  | { type: "set"; field: keyof UIState; value: UIState[keyof UIState] }
  | { type: "toggleSearch" }
  | { type: "resetForProject"; activePid: string };

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case "set": return { ...state, [action.field]: action.value };
    case "toggleSearch": return { ...state, searchOpen: !state.searchOpen };
    case "resetForProject": return { ...state, prevActivePid: action.activePid, contextMenu: null, confirmDeleteSession: null };
    default: return state;
  }
}

const centeredAppStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center" };
const dimTextStyle: React.CSSProperties = { color: "var(--text-dim)" };

export default function App() {
  const t = useT();
  // Scalar selectors only — never subscribe to objects that change often
  const activePid = useStore((s) => s.activePid);
  const activeSid = useStore((s) => s.activeSid);
  const loaded = useStore((s) => s.loaded);
  const previewView = usePreviewStore(s => s.views[activePid] ?? EMPTY_PREVIEW);
  // Stable selectors — return same ref if project/session unchanged
  const activeProject = useStore(selectActiveProject);
  const activeSession = useStore(selectActiveSession);
  // Actions (stable refs — zustand actions never change)
  const projects = useStore((s) => s.projects);
  const removeSession = useStore((s) => s.removeSession);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);

  const [ui, dispatch] = useReducer(uiReducer, {
    showSupervision: false,
    showNewProject: false, showPreferences: false, confirmDeleteSession: null,
    searchOpen: false, showStatuslinePrompt: false, showInstallClaude: false,
    contextMenu: null,
    updateStatus: { state: "idle" } as UpdateStatus, prevActivePid: "",
  });
  const resizingRef = useRef(false);
  const mountedSidsRef = useRef(new Set<string>());
  const onboardingTracked = useRef(false);

  useAppInit(dispatch);
  useThemeSync();

  useEffect(() => {
    dispatch({ type: "set", field: "showSupervision", value: false });
  }, [activeSid]);

  useEffect(() => {
    if (loaded && (!activeProject || !activeSession) && !onboardingTracked.current) {
      onboardingTracked.current = true;
      trackEvent("onboarding_shown");
    }
  }, [loaded, activeProject, activeSession]);

  if (activePid !== ui.prevActivePid) dispatch({ type: "resetForProject", activePid });

  const handleSearchClose = useCallback(() => {
    dispatch({ type: "set", field: "searchOpen", value: false });
  }, []);

  const handleResizeStart = useCallback(() => {
    resizingRef.current = true;
    let rafId = 0;
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => setSidebarWidth(Math.min(400, Math.max(280, e.clientX))));
    };
    const onUp = () => { resizingRef.current = false; cancelAnimationFrame(rafId); document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [setSidebarWidth]);

  const contextMenuStyle = useMemo(
    () => ui.contextMenu ? { left: Math.max(8, Math.min(ui.contextMenu.x, window.innerWidth - 220)), top: Math.max(8, Math.min(ui.contextMenu.y, window.innerHeight - 200)) } : undefined,
    [ui.contextMenu]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      handleKeyboardShortcut(e, {
        showNewProject: () => { trackEvent("shortcut_used", { key: "new_project" }); dispatch({ type: "set", field: "showNewProject", value: true }); },
        confirmDeleteSession: (sid) => { trackEvent("shortcut_used", { key: "close_session" }); dispatch({ type: "set", field: "confirmDeleteSession", value: sid }); },
        toggleSearch: () => { trackEvent("shortcut_used", { key: "search" }); dispatch({ type: "toggleSearch" }); },
        showPreferences: () => { trackEvent("shortcut_used", { key: "preferences" }); dispatch({ type: "set", field: "showPreferences", value: true }); },
      });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (!loaded) return <div className="app" style={centeredAppStyle}><span style={dimTextStyle}>{t("app.loading")}</span></div>;

  if (!activeProject || !activeSession) {

    return (
      <div className="app" style={centeredAppStyle}>
        <div className="onboarding">
          <img src="/orbit-logo.png" className="onboarding__logo" alt="Orbit" />
          <h1 className="onboarding__title">Orbit</h1>
          <p className="onboarding__subtitle">{t("app.welcomeSubtitle")}</p>
          <button className="onboarding__cta" onClick={() => dispatch({ type: "set", field: "showNewProject", value: true })}>{t("app.createProject")}</button>
          <p className="onboarding__hint">{t("app.welcomeHint")}</p>
        </div>
        {ui.showNewProject && <Suspense fallback={null}><NewProjectModal onClose={() => dispatch({ type: "set", field: "showNewProject", value: false })} /></Suspense>}
      </div>
    );
  }

  // Track which sessions have been visited — keep them mounted across all projects
  // Clean up only truly deleted sessions (not in ANY project)
  const allSids = new Set(projects.flatMap((p) => p.sessions.filter((s) => s.archivedAt === undefined).map((s) => s.id)));
  for (const sid of mountedSidsRef.current) {
    if (!allSids.has(sid)) mountedSidsRef.current.delete(sid);
  }
  mountedSidsRef.current.add(activeSid);
  const mountedSids = mountedSidsRef.current;

  return (
    <div className="app">
      <div className="main">
        <Sidebar
          supervisionOpen={ui.showSupervision}
          onSupervision={() => dispatch({ type: "set", field: "showSupervision", value: true })}
          onSessionOpen={() => dispatch({ type: "set", field: "showSupervision", value: false })}
          onNewProject={() => dispatch({ type: "set", field: "showNewProject", value: true })}
          onPreferences={() => dispatch({ type: "set", field: "showPreferences", value: true })}
          onContextMenu={(sid, x, y) => dispatch({ type: "set", field: "contextMenu", value: { sid, x, y } })} />
        <div className="resize-handle" role="separator" aria-orientation="vertical" onMouseDown={handleResizeStart} />
        <div className="terminal-area">
          <div className="chat__breadcrumb">
            {ui.showSupervision ? <><span>{t("supervision.title")}</span><div className="chat__breadcrumb-spacer" /><button className="supervision-back" onClick={() => dispatch({ type: "set", field: "showSupervision", value: false })}>{t("supervision.back")}</button></> : <><span>{activeProject.name}</span> &rsaquo; <span className="chat__session-name" title={activeProject.dir}>{activeSession.name}</span><div className="chat__breadcrumb-spacer" /><ContextBar conversationId={activeSession.type === "terminal" ? undefined : activeSession.claudeSessionId} /><TerminalToolbar searchOpen={ui.searchOpen} onSearch={() => dispatch({ type: "toggleSearch" })} /><button className="preview-toggle" title={t("preview.open")} aria-label={t("preview.open")} aria-pressed={previewView.open} onClick={() => usePreviewStore.getState().dispatch(activePid, { type: "toggle" })}><PreviewIcon kind="panel" /><span>{t("preview.title")}</span></button></>}
          </div>
          <ErrorBoundary>
            {!ui.showSupervision && activeSession.type !== "terminal" && <SubagentRoster key={activeSid} conversationId={activeSession.claudeSessionId} />}
            {ui.showSupervision && <SupervisionPanel onOpen={(sid) => { useStore.getState().setActiveSession(sid); dispatch({ type: "set", field: "showSupervision", value: false }); }} />}
            <div className={`terminal-area__body ${ui.showSupervision ? "terminal-area__body--supervision" : ""}`}>
              <div className="terminal-area__terminals">
                <Suspense fallback={<div role="status">{t("app.loading")}</div>}>
                {projects.flatMap((p) =>
                    p.sessions.filter((s) => s.archivedAt === undefined && mountedSids.has(s.id)).map((s) => (
                      <TerminalView key={s.id} sessionId={s.id} projectDir={p.dir}
                        active={!ui.showSupervision && s.id === activeSid}
                        visible={!ui.showSupervision && s.id === activeSid}
                        searchOpen={!ui.showSupervision && s.id === activeSid && ui.searchOpen}
                        onSearchClose={handleSearchClose}
                        sessionType={s.type ?? "claude"} />
                    )))}
                </Suspense>
              </div>
            </div>
          </ErrorBoundary>
        </div>
        <Suspense fallback={null}>{!ui.showSupervision && previewView.open && <PreviewPane key={activePid} projectId={activePid} projectDir={activeProject.dir} projectName={activeProject.name} />}</Suspense>
      </div>

      <UpdateBanner status={ui.updateStatus} />
      <StatusBar />

      <ErrorBoundary>
        {ui.showNewProject && <Suspense fallback={null}><NewProjectModal onClose={() => dispatch({ type: "set", field: "showNewProject", value: false })} /></Suspense>}
        {ui.showPreferences && <Suspense fallback={null}><PreferencesModal onClose={() => dispatch({ type: "set", field: "showPreferences", value: false })} /></Suspense>}
        {ui.contextMenu && (
          <div className="context-menu-overlay" role="presentation" onClick={() => dispatch({ type: "set", field: "contextMenu", value: null })} onKeyDown={(e) => { if (e.key === "Escape") dispatch({ type: "set", field: "contextMenu", value: null }); }}>
            <FocusTrap onEscape={() => dispatch({ type: "set", field: "contextMenu", value: null })}>
            <div className="context-menu" role="menu" style={contextMenuStyle} onClick={(e) => e.stopPropagation()}>
              <button className="context-menu__item" onClick={() => { window.dispatchEvent(new CustomEvent("rename-session", { detail: { sessionId: ui.contextMenu!.sid } })); dispatch({ type: "set", field: "contextMenu", value: null }); }}>{t("session.rename")}</button>
              <button className="context-menu__item" onClick={() => { window.dispatchEvent(new CustomEvent("reset-session", { detail: { sessionId: ui.contextMenu!.sid } })); trackEvent("session_reset"); dispatch({ type: "set", field: "contextMenu", value: null }); }}>{t("session.reset")}</button>
              <button className="context-menu__item" onClick={() => { useStore.getState().toggleSessionPinned(ui.contextMenu!.sid); dispatch({ type: "set", field: "contextMenu", value: null }); }}>{t(projects.some((p) => p.sessions.some((s) => s.id === ui.contextMenu!.sid && s.pinned)) ? "sidebar.unpin" : "sidebar.pin", { name: projects.flatMap((p) => p.sessions).find((s) => s.id === ui.contextMenu!.sid)?.name ?? "" })}</button>
              <button className="context-menu__item context-menu__item--danger" onClick={() => { dispatch({ type: "set", field: "confirmDeleteSession", value: ui.contextMenu!.sid }); dispatch({ type: "set", field: "contextMenu", value: null }); }}>{t("common.delete")}</button>
            </div>
            </FocusTrap>
          </div>
        )}
        {ui.showStatuslinePrompt && <StatuslineModal onClose={() => dispatch({ type: "set", field: "showStatuslinePrompt", value: false })} />}
        {ui.confirmDeleteSession && <DeleteSessionModal sessionId={ui.confirmDeleteSession} sessions={projects.flatMap((p) => p.sessions)}
          onConfirm={() => { removeSession(ui.confirmDeleteSession!); trackEvent("session_deleted"); dispatch({ type: "set", field: "confirmDeleteSession", value: null }); }}
          onCancel={() => dispatch({ type: "set", field: "confirmDeleteSession", value: null })} />}
        {ui.showInstallClaude && <InstallClaudeModal onClose={() => dispatch({ type: "set", field: "showInstallClaude", value: false })} />}
      </ErrorBoundary>
    </div>
  );
}
