import { useReducer, useRef, useCallback, useEffect, useMemo, lazy, Suspense } from "react";
import type { TerminalPref } from "./core/types";
import { useStore } from "./core/store";
import { pty, terminal } from "./core/api";
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
const CommandPalette = lazy(() => import("./features/CommandPalette"));
const GitPanel = lazy(() => import("./features/git/GitPanel"));
const DiffViewer = lazy(() => import("./features/git/DiffViewer"));
const PromptCoach = lazy(() => import("./features/PromptCoach"));
const NewProjectModal = lazy(() => import("./modals/NewProjectModal"));
const PreferencesModal = lazy(() => import("./modals/PreferencesModal"));

// --- Helpers ---

async function openExternalTerminal(t: TerminalPref, dir: string) {
  try {
    await terminal.openExternal(t, dir);
  } catch (err) {
    import("./lib/logger").then(({ logger }) => logger.error("app", `Failed to open terminal: ${err}`));
  }
}

// --- UI State ---

interface UIState {
  showNewProject: boolean;
  showPreferences: boolean;
  confirmDeleteSession: string | null;
  searchOpen: boolean;
  showStatuslinePrompt: boolean;
  showInstallClaude: boolean;
  contextMenu: { sid: string; x: number; y: number } | null;
  showCommandPalette: boolean;
  showPromptCoach: boolean;
  updateStatus: UpdateStatus;
  prevActivePid: string;
}

type UIAction =
  | { type: "set"; field: keyof UIState; value: UIState[keyof UIState] }
  | { type: "toggleSearch" }
  | { type: "toggleCommandPalette" }
  | { type: "resetForProject"; activePid: string };

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case "set": return { ...state, [action.field]: action.value };
    case "toggleSearch": return { ...state, searchOpen: !state.searchOpen };
    case "toggleCommandPalette": return { ...state, showCommandPalette: !state.showCommandPalette };
    case "resetForProject": return { ...state, prevActivePid: action.activePid, contextMenu: null, confirmDeleteSession: null };
    default: return state;
  }
}

const centeredAppStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center" };
const dimTextStyle: React.CSSProperties = { color: "var(--text-dim)" };

export default function App() {
  const t = useT();
  const projects = useStore((s) => s.projects);
  const activePid = useStore((s) => s.activePid);
  const activeSid = useStore((s) => s.activeSid);
  const settings = useStore((s) => s.settings);
  const loaded = useStore((s) => s.loaded);
  const notifiedSessions = useStore((s) => s.notifiedSessions);
  const sessionCosts = useStore((s) => s.sessionCosts);
  const splitLayout = useStore((s) => s.splitLayout);
  const setActiveProject = useStore((s) => s.setActiveProject);
  const setActiveSession = useStore((s) => s.setActiveSession);
  const addSession = useStore((s) => s.addSession);
  const removeSession = useStore((s) => s.removeSession);
  const renameSession = useStore((s) => s.renameSession);
  const removeProject = useStore((s) => s.removeProject);
  const renameProject = useStore((s) => s.renameProject);
  const clearNotification = useStore((s) => s.clearNotification);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);

  const [ui, dispatch] = useReducer(uiReducer, {
    showNewProject: false, showPreferences: false, confirmDeleteSession: null,
    searchOpen: false, showStatuslinePrompt: false, showInstallClaude: false,
    contextMenu: null, showCommandPalette: false, showPromptCoach: false,
    updateStatus: { state: "idle" } as UpdateStatus, prevActivePid: "",
  });
  const resizingRef = useRef(false);

  useAppInit(dispatch);
  useThemeSync();

  const activeProject = projects.find((p) => p.id === activePid);
  if (activePid !== ui.prevActivePid) dispatch({ type: "resetForProject", activePid });
  const activeSession = activeProject?.sessions.find((s) => s.id === activeSid);

  const handleResizeStart = useCallback(() => {
    resizingRef.current = true;
    const onMove = (e: MouseEvent) => { if (!resizingRef.current) return; setSidebarWidth(Math.min(320, Math.max(150, e.clientX))); };
    const onUp = () => { resizingRef.current = false; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [setSidebarWidth]);

  const handleOpenTerminal = useCallback(() => {
    if (activeProject) openExternalTerminal(settings.terminal, activeProject.dir);
  }, [activeProject, settings.terminal]);

  const openSkillSession = useCallback(async (name: string, command: string) => {
    const store = useStore.getState();
    const proj = store.projects.find((p) => p.id === store.activePid);
    const existing = proj?.sessions.find((s) => s.name === name);
    const targetSid = existing ? existing.id : (() => { store.addSession(name); return useStore.getState().activeSid; })();
    if (existing) store.setActiveSession(existing.id);
    for (let attempt = 0; attempt < 10; attempt++) {
      try { await pty.write(targetSid, command + "\r"); break; }
      catch { await new Promise((r) => setTimeout(r, 300)); }
    }
    trackEvent("skill_session_opened", { skill: command });
  }, []);

  const sendPromptToActiveSession = useCallback(async (prompt: string) => {
    try { await pty.write(activeSid, prompt + "\r"); }
    catch (err) { import("./lib/logger").then(({ logger }) => logger.warn("app", `write_pty failed: ${err}`)); }
  }, [activeSid]);

  const openPromptCoach = useCallback(() => { dispatch({ type: "set", field: "showPromptCoach", value: true }); trackEvent("prompt_coach_opened"); }, []);

  const contextMenuStyle = useMemo(
    () => ui.contextMenu ? { left: ui.contextMenu.x, top: ui.contextMenu.y } : undefined,
    [ui.contextMenu]
  );

  const sendFromCoach = useCallback(async (prompt: string) => {
    try { await pty.write(activeSid, "\x15" + prompt); }
    catch (err) { import("./lib/logger").then(({ logger }) => logger.warn("app", `write_pty failed: ${err}`)); }
  }, [activeSid]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      handleKeyboardShortcut(e, {
        showNewProject: () => dispatch({ type: "set", field: "showNewProject", value: true }),
        confirmDeleteSession: (sid) => dispatch({ type: "set", field: "confirmDeleteSession", value: sid }),
        toggleSearch: () => { trackEvent("search_opened"); dispatch({ type: "toggleSearch" }); },
        showPreferences: () => dispatch({ type: "set", field: "showPreferences", value: true }),
        toggleCommandPalette: () => dispatch({ type: "toggleCommandPalette" }),
        openExternalTerminal: (terminal, dir) => openExternalTerminal(terminal as TerminalPref, dir),
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
        {ui.showNewProject && <NewProjectModal onClose={() => dispatch({ type: "set", field: "showNewProject", value: false })} />}
      </div>
    );
  }

  const isSplit = splitLayout.type !== "none" && splitLayout.secondarySid;

  return (
    <div className="app">
      <TabBar projects={projects} activePid={activePid} notifiedSessions={notifiedSessions}
        onSelectProject={(pid) => setActiveProject(pid)} onRenameProject={renameProject} onRemoveProject={removeProject}
        onClearNotification={clearNotification} onNewProject={() => dispatch({ type: "set", field: "showNewProject", value: true })}
        onCommandPalette={() => dispatch({ type: "set", field: "showCommandPalette", value: true })} onOpenTerminal={handleOpenTerminal} />

      <div className="main">
        <Sidebar activeProject={activeProject} activeSid={activeSid} notifiedSessions={notifiedSessions}
          sessionCosts={sessionCosts} sidebarWidth={settings.sidebarWidth} onSelectSession={setActiveSession}
          onClearNotification={clearNotification} onRenameSession={renameSession} onAddSession={() => addSession()}
          onContextMenu={(sid, x, y) => dispatch({ type: "set", field: "contextMenu", value: { sid, x, y } })}
          onOpenSkillSession={openSkillSession} onOpenPromptCoach={openPromptCoach} onSendToSession={sendPromptToActiveSession} />
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
                {!isSplit && projects.map((p) =>
                  p.sessions.map((s) => {
                    const isThisActive = p.id === activePid && s.id === activeSid;
                    return (
                      <TerminalView key={s.id} sessionId={s.id} projectDir={p.dir}
                        active={isThisActive}
                        visible={isThisActive}
                        searchOpen={isThisActive && ui.searchOpen}
                        onSearchClose={() => dispatch({ type: "set", field: "searchOpen", value: false })} />
                    );
                  })
                )}
                {ui.showPromptCoach && <Suspense fallback={null}><PromptCoach onSend={sendFromCoach} onClose={() => dispatch({ type: "set", field: "showPromptCoach", value: false })} /></Suspense>}
              </div>
              <ErrorBoundary><Suspense fallback={null}><DiffViewer /></Suspense></ErrorBoundary>
            </div>
          </ErrorBoundary>
          <ErrorBoundary><Suspense fallback={null}><GitPanel /></Suspense></ErrorBoundary>
        </div>
      </div>

      <UpdateBanner status={ui.updateStatus} />
      <StatusBar activeProject={activeProject} activeSession={activeSession} activeCost={sessionCosts[activeSid]} isSplit={!!isSplit} theme={settings.theme} fontSize={settings.fontSize} />

      <ErrorBoundary>
        {ui.showNewProject && <Suspense fallback={null}><NewProjectModal onClose={() => dispatch({ type: "set", field: "showNewProject", value: false })} /></Suspense>}
        {ui.showPreferences && <Suspense fallback={null}><PreferencesModal onClose={() => dispatch({ type: "set", field: "showPreferences", value: false })} /></Suspense>}
        {ui.showCommandPalette && <Suspense fallback={null}><CommandPalette onClose={() => dispatch({ type: "set", field: "showCommandPalette", value: false })} onSelectPrompt={sendPromptToActiveSession} /></Suspense>}
        {ui.contextMenu && (
          <div className="context-menu-overlay" role="presentation" onClick={() => dispatch({ type: "set", field: "contextMenu", value: null })} onKeyDown={(e) => { if (e.key === "Escape") dispatch({ type: "set", field: "contextMenu", value: null }); }}>
            <div className="context-menu" role="menu" style={contextMenuStyle} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
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
