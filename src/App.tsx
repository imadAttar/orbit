import { useReducer, useRef, useCallback, useEffect, useMemo, lazy, Suspense } from "react";
import { useStore, selectActiveProject, selectActiveSession } from "./core/store";
import { trackEvent } from "./lib/analytics";
import { useT } from "./i18n/i18n";
import TerminalView from "./features/terminal/Terminal";
import SplitPane from "./features/terminal/SplitPane";
import ContextBar from "./layout/ContextBar";
import ErrorBoundary from "./shared/ErrorBoundary";
import TabBar from "./layout/TabBar";
import Sidebar from "./layout/Sidebar";
import UpdateBanner from "./features/UpdateBanner";
import StatusBar from "./layout/StatusBar";
import { StatuslineModal, DeleteSessionModal, InstallClaudeModal } from "./modals/AppModals";
import { handleKeyboardShortcut } from "./keyboard/keyboardHandler";
import type { UpdateStatus } from "./features/updater";
import { useAppInit } from "./hooks/useAppInit";
import { useThemeSync } from "./hooks/useThemeSync";

// Lazy-loaded heavy components (code-split)
const NewProjectModal = lazy(() => import("./modals/NewProjectModal"));
const PreferencesModal = lazy(() => import("./modals/PreferencesModal"));

// --- UI State ---

interface UIState {
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
  const splitLayout = useStore((s) => s.splitLayout);
  // Stable selectors — return same ref if project/session unchanged
  const activeProject = useStore(selectActiveProject);
  const activeSession = useStore(selectActiveSession);
  // Actions (stable refs — zustand actions never change)
  const projects = useStore((s) => s.projects);
  const removeSession = useStore((s) => s.removeSession);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);

  const [ui, dispatch] = useReducer(uiReducer, {
    showNewProject: false, showPreferences: false, confirmDeleteSession: null,
    searchOpen: false, showStatuslinePrompt: false, showInstallClaude: false,
    contextMenu: null,
    updateStatus: { state: "idle" } as UpdateStatus, prevActivePid: "",
  });
  const resizingRef = useRef(false);
  const mountedSidsRef = useRef(new Set<string>());

  useAppInit(dispatch);
  useThemeSync();

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
      rafId = requestAnimationFrame(() => setSidebarWidth(Math.min(320, Math.max(150, e.clientX))));
    };
    const onUp = () => { resizingRef.current = false; cancelAnimationFrame(rafId); document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [setSidebarWidth]);

  const contextMenuStyle = useMemo(
    () => ui.contextMenu ? { left: ui.contextMenu.x, top: ui.contextMenu.y } : undefined,
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
    if (!ui.prevActivePid) trackEvent("onboarding_shown");
    return (
      <div className="app" style={centeredAppStyle}>
        <div className="onboarding">
          <img src="/orbit-logo.png" className="onboarding__logo" alt="Orbit" />
          <h1 className="onboarding__title">Orbit</h1>
          <p className="onboarding__subtitle">{t("app.welcomeSubtitle")}</p>
          <button className="onboarding__cta" onClick={() => dispatch({ type: "set", field: "showNewProject", value: true })}>{t("app.createProject")}</button>
          <p className="onboarding__hint">{t("app.welcomeHint")}</p>
        </div>
        {ui.showNewProject && <NewProjectModal onClose={() => dispatch({ type: "set", field: "showNewProject", value: false })} />}
      </div>
    );
  }

  // Track which sessions have been visited — keep them mounted across all projects
  // Clean up only truly deleted sessions (not in ANY project)
  const allSids = new Set(projects.flatMap((p) => p.sessions.map((s) => s.id)));
  for (const sid of mountedSidsRef.current) {
    if (!allSids.has(sid)) mountedSidsRef.current.delete(sid);
  }
  mountedSidsRef.current.add(activeSid);
  const mountedSids = mountedSidsRef.current;

  const isSplit = splitLayout.type !== "none" && splitLayout.secondarySid;

  return (
    <div className="app">
      <TabBar
        onNewProject={() => dispatch({ type: "set", field: "showNewProject", value: true })} />

      <div className="main">
        <Sidebar
          onContextMenu={(sid, x, y) => dispatch({ type: "set", field: "contextMenu", value: { sid, x, y } })} />
        <div className="resize-handle" role="separator" aria-orientation="vertical" onMouseDown={handleResizeStart} />
        <div className="terminal-area">
          <div className="chat__breadcrumb">
            <span>{activeProject.name}</span> &rsaquo; <span style={dimTextStyle}>{activeProject.dir}</span> &rsaquo; <span>{activeSession.name}</span>
            <div className="chat__breadcrumb-spacer" /><ContextBar />
          </div>
          <ErrorBoundary>
            <div className="terminal-area__body">
              <div className="terminal-area__terminals">
                {isSplit && (
                  <SplitPane primarySid={splitLayout.primarySid || activeSid} secondarySid={splitLayout.secondarySid!}
                    projectDir={activeProject.dir} ratio={splitLayout.ratio} searchOpen={ui.searchOpen}
                    onSearchClose={() => dispatch({ type: "set", field: "searchOpen", value: false })} />
                )}
                {!isSplit && projects.flatMap((p) =>
                    p.sessions.filter((s) => mountedSids.has(s.id)).map((s) => (
                      <TerminalView key={s.id} sessionId={s.id} projectDir={p.dir}
                        active={s.id === activeSid}
                        visible={s.id === activeSid}
                        searchOpen={s.id === activeSid && ui.searchOpen}
                        onSearchClose={handleSearchClose}
                        sessionType={s.type ?? "claude"} />
                    )))}
              </div>
            </div>
          </ErrorBoundary>
        </div>
      </div>

      <UpdateBanner status={ui.updateStatus} />
      <StatusBar />

      <ErrorBoundary>
        {ui.showNewProject && <Suspense fallback={null}><NewProjectModal onClose={() => dispatch({ type: "set", field: "showNewProject", value: false })} /></Suspense>}
        {ui.showPreferences && <Suspense fallback={null}><PreferencesModal onClose={() => dispatch({ type: "set", field: "showPreferences", value: false })} /></Suspense>}
        {ui.contextMenu && (
          <div className="context-menu-overlay" role="presentation" onClick={() => dispatch({ type: "set", field: "contextMenu", value: null })} onKeyDown={(e) => { if (e.key === "Escape") dispatch({ type: "set", field: "contextMenu", value: null }); }}>
            <div className="context-menu" role="menu" style={contextMenuStyle} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <button className="context-menu__item" onClick={() => { window.dispatchEvent(new CustomEvent("rename-session", { detail: { sessionId: ui.contextMenu!.sid } })); dispatch({ type: "set", field: "contextMenu", value: null }); }}>{t("session.rename")}</button>
              <button className="context-menu__item" onClick={() => { window.dispatchEvent(new CustomEvent("reset-session", { detail: { sessionId: ui.contextMenu!.sid } })); trackEvent("session_reset"); dispatch({ type: "set", field: "contextMenu", value: null }); }}>{t("session.reset")}</button>
              {activeProject.sessions.length > 1 && <button className="context-menu__item context-menu__item--danger" onClick={() => { dispatch({ type: "set", field: "confirmDeleteSession", value: ui.contextMenu!.sid }); dispatch({ type: "set", field: "contextMenu", value: null }); }}>{t("common.delete")}</button>}
            </div>
          </div>
        )}
        {ui.showStatuslinePrompt && <StatuslineModal onClose={() => dispatch({ type: "set", field: "showStatuslinePrompt", value: false })} />}
        {ui.confirmDeleteSession && <DeleteSessionModal sessionId={ui.confirmDeleteSession} sessions={activeProject.sessions}
          onConfirm={() => { removeSession(ui.confirmDeleteSession!); trackEvent("session_deleted"); dispatch({ type: "set", field: "confirmDeleteSession", value: null }); }}
          onCancel={() => dispatch({ type: "set", field: "confirmDeleteSession", value: null })} />}
        {ui.showInstallClaude && <InstallClaudeModal onClose={() => dispatch({ type: "set", field: "showInstallClaude", value: false })} />}
      </ErrorBoundary>
    </div>
  );
}
