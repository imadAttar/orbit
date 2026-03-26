import { useEffect, useRef, useReducer } from "react";
import { useStore } from "../../core/store";
import { trackEvent } from "../../lib/analytics";
import { pty, claude } from "../../core/api";
import { logger } from "../../lib/logger";
import { useT } from "../../i18n/i18n";
import { usePTY } from "./hooks/usePTY";
import { usePromptNav } from "./hooks/usePromptNav";
import { useTerminalSearch } from "./hooks/useTerminalSearch";
import { useTerminalRestore } from "./hooks/useTerminalRestore";
import "@xterm/xterm/css/xterm.css";

interface TermState {
  activated: boolean;
  restoreChoice: "pending" | "ask" | "resume" | "fresh";
  modeChoice: "normal" | "yolo" | null;
  generation: number;
  spawned: boolean;
  searchQuery: string;
}

type TermAction =
  | { type: "activate" }
  | { type: "setRestore"; value: TermState["restoreChoice"] }
  | { type: "setMode"; value: TermState["modeChoice"] }
  | { type: "setSpawned"; value: boolean }
  | { type: "setQuery"; value: string }
  | { type: "reset" };

function termReducer(state: TermState, action: TermAction): TermState {
  switch (action.type) {
    case "activate": return { ...state, activated: true };
    case "setRestore": return { ...state, restoreChoice: action.value };
    case "setMode": return { ...state, modeChoice: action.value };
    case "setSpawned": return { ...state, spawned: action.value };
    case "setQuery": return { ...state, searchQuery: action.value };
    case "reset": return { ...state, spawned: false, generation: state.generation + 1 };
    default: return state;
  }
}

const INITIAL_TERM_STATE: TermState = {
  activated: false, restoreChoice: "pending", modeChoice: null,
  generation: 0, spawned: false, searchQuery: "",
};

interface Props {
  sessionId: string;
  projectDir: string;
  active: boolean;
  visible?: boolean;
  searchOpen: boolean;
  onSearchClose: () => void;
  sessionType?: "claude" | "terminal";
}

export default function TerminalView({ sessionId, projectDir, active, visible, searchOpen, onSearchClose, sessionType }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const t = useT();
  const [ts, dp] = useReducer(termReducer, INITIAL_TERM_STATE);
  const rememberRef = useRef<HTMLInputElement>(null);

  const isVisible = active || visible;

  // Prompt navigation uses a forwarded ref synced from usePTY
  const ptyTermRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const { jumpToPrompt, jumpRef } = usePromptNav(ptyTermRef);

  const isTerminalSession = sessionType === "terminal";

  // --- PTY lifecycle hook ---
  const ptyResult = usePTY({
    sessionId,
    projectDir,
    containerRef,
    activated: ts.activated,
    restoreChoice: ts.restoreChoice,
    modeChoice: isTerminalSession ? "normal" : ts.modeChoice, // terminal sessions skip mode picker
    generation: ts.generation,
    isVisible: isVisible ?? false,
    jumpRef,
    onSpawned: (v) => dp({ type: "setSpawned", value: v }),
    spawned: ts.spawned,
    sessionType,
    t,
  });

  // Sync ptyTermRef for prompt navigation
  ptyTermRef.current = ptyResult.termRef.current;

  // --- Terminal search hook ---
  const { searchInputRef, doSearchNext, doSearchPrev } = useTerminalSearch(
    ptyResult.searchRef, ptyResult.termRef, searchOpen, ts.searchQuery,
  );

  // Lazy activation: mark as activated the first time terminal becomes visible
  useEffect(() => {
    if (isVisible && !ts.activated) {
      dp({ type: "activate" });
    }
  }, [isVisible, ts.activated]);

  // Restore lifecycle: scrollback check, reset handler, auto-mode
  useTerminalRestore({
    sessionId,
    activated: ts.activated,
    generation: ts.generation,
    restoreChoice: ts.restoreChoice,
    modeChoice: ts.modeChoice,
    termRef: ptyResult.termRef,
    spawnedRef: ptyResult.spawnedRef,
    dp,
  });

  // Terminal sessions auto-resolve mode (no picker needed)
  useEffect(() => {
    if (!isTerminalSession) return;
    if (ts.modeChoice !== null) return;
    dp({ type: "setMode", value: "normal" });
  }, [isTerminalSession, ts.modeChoice]);

  // Can this session be deleted?
  const canDelete = useStore((s) => {
    const proj = s.projects.find((p) => p.sessions.some((sess) => sess.id === sessionId));
    return proj ? proj.sessions.length > 1 : false;
  });

  // Focus terminal when active (and search not open)
  useEffect(() => {
    if (active && ptyResult.termRef.current && !searchOpen) {
      ptyResult.termRef.current.focus();
    }
  }, [active, searchOpen]);

  return (
    <div className={`terminal-wrapper ${isVisible ? "" : "terminal-wrapper--hidden"}`}>
      {/* Session restore prompt */}
      {ts.restoreChoice === "ask" && (
        <div className="session-restore">
          <span className="session-restore__text">{t("session.previousAvailable")}</span>
          <button
            className="session-restore__btn session-restore__btn--resume"
            onClick={() => { dp({ type: "setRestore", value: "resume" }); trackEvent("session_resumed"); }}
          >
            {t("session.resume")}
          </button>
          <button
            className="session-restore__btn session-restore__btn--fresh"
            onClick={() => { dp({ type: "setRestore", value: "fresh" }); trackEvent("session_fresh_start"); }}
          >
            {t("session.freshStart")}
          </button>
          {canDelete && (
              <button
                className="session-restore__btn session-restore__btn--delete"
                onClick={async () => {
                  try {
                    const session = useStore.getState().projects
                      .flatMap((p) => p.sessions)
                      .find((s) => s.id === sessionId);
                    if (session?.claudeSessionId) {
                      await claude.deleteSession(projectDir, session.claudeSessionId);
                    }
                  } catch (err) {
                    logger.error("terminal", `Failed to delete session: ${err}`);
                  }
                  useStore.getState().removeSession(sessionId);
                  trackEvent("session_deleted");
                }}
              >
                {t("session.delete")}
              </button>
          )}
        </div>
      )}
      {/* Mode picker — Claude sessions only */}
      {!isTerminalSession && (ts.restoreChoice === "resume" || ts.restoreChoice === "fresh") && ts.modeChoice === null && (
        <div className="mode-picker">
          <span className="mode-picker__title">{t("mode.title")}</span>
          <div className="mode-picker__options">
            <button
              className="mode-picker__option mode-picker__option--safe"
              onClick={() => {
                const setDefault = rememberRef.current?.checked;
                if (setDefault) useStore.getState().setDefaultMode("normal");
                dp({ type: "setMode", value: "normal" });
                trackEvent("mode_normal");
              }}
            >
              <span className="mode-picker__icon">&#x2714;</span>
              <span className="mode-picker__label">{t("mode.safe")}</span>
              <span className="mode-picker__desc">{t("mode.safeDesc")}</span>
            </button>
            <button
              className="mode-picker__option mode-picker__option--danger"
              onClick={() => {
                const setDefault = rememberRef.current?.checked;
                if (setDefault) useStore.getState().setDefaultMode("yolo");
                dp({ type: "setMode", value: "yolo" });
                trackEvent("mode_yolo");
              }}
            >
              <span className="mode-picker__icon">&#x26A1;</span>
              <span className="mode-picker__label">{t("mode.danger")}</span>
              <span className="mode-picker__desc">{t("mode.dangerDesc")}</span>
            </button>
          </div>
          <label className="mode-picker__default">
            <input type="checkbox" ref={rememberRef} />
            <span>{t("mode.remember")}</span>
          </label>
        </div>
      )}
      {searchOpen && (
        <div className="search-bar">
          <input
            ref={searchInputRef}
            className="search-bar__input"
            value={ts.searchQuery}
            onChange={(e) => dp({ type: "setQuery", value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.shiftKey ? doSearchPrev() : doSearchNext();
              }
              if (e.key === "Escape") onSearchClose();
            }}
            placeholder={t("common.search")}
          />
          <button className="search-bar__btn" onClick={doSearchPrev} title={t("common.previous")}>&#x25B2;</button>
          <button className="search-bar__btn" onClick={doSearchNext} title={t("common.next")}>&#x25BC;</button>
          <span className="search-bar__sep" />
          <button className="search-bar__btn" onClick={() => { jumpToPrompt("prev"); trackEvent("prompt_nav", { direction: "prev" }); }} title={t("nav.prevPrompt")}>&#x23F6;</button>
          <button className="search-bar__btn" onClick={() => { jumpToPrompt("next"); trackEvent("prompt_nav", { direction: "next" }); }} title={t("nav.nextPrompt")}>&#x23F7;</button>
          <button className="search-bar__btn" onClick={onSearchClose} title={t("common.close")}>&#x2715;</button>
        </div>
      )}
      {/* Prompt navigation — floating mini-nav */}
      {ts.spawned && !searchOpen && (
        <div className="prompt-nav">
          <button className="prompt-nav__btn" onClick={() => { jumpToPrompt("prev"); trackEvent("prompt_nav", { direction: "prev" }); }} title={t("nav.prevPrompt")}>&#x25B2;</button>
          <button className="prompt-nav__btn" onClick={() => { jumpToPrompt("next"); trackEvent("prompt_nav", { direction: "next" }); }} title={t("nav.nextPrompt")}>&#x25BC;</button>
        </div>
      )}
      <div ref={containerRef} className="terminal-container" />
      {/* Mode toggle button — Claude sessions only */}
      {!isTerminalSession && ts.modeChoice && ts.spawned && (
        <button
          className={`mode-toggle ${ts.modeChoice === "yolo" ? "mode-toggle--yolo" : "mode-toggle--safe"}`}
          title={ts.modeChoice === "yolo" ? t("mode.toggleToSafe") : t("mode.toggleToDanger")}
          onClick={() => {
            const next = ts.modeChoice === "yolo" ? "normal" : "yolo";
            dp({ type: "setMode", value: next as "normal" | "yolo" });
            dp({ type: "setRestore", value: "fresh" });
            useStore.getState().setDangerousMode(sessionId, next === "yolo");
            if (ptyResult.termRef.current) {
              ptyResult.termRef.current.clear();
              ptyResult.termRef.current.reset();
            }
            pty.killSilent(sessionId);
            ptyResult.spawnedRef.current = false;
            dp({ type: "reset" });
            trackEvent("mode_toggle", { mode: next });
          }}
        >
          {ts.modeChoice === "yolo" ? `\u26A1 ${t("mode.danger")}` : `\u2714 ${t("mode.safe")}`}
        </button>
      )}
    </div>
  );
}
