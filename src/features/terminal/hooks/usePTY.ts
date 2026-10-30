import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useStore } from "../../../core/store";
import { THEMES } from "../../../lib/themes";
import { stripAnsi } from "../../../lib/terminalParser";
import { trackEvent } from "../../../lib/analytics";
import { pty, terminal, scrollback, listen, claude } from "../../../core/api";
import { useScrollback } from "./useScrollback";
import { createTerminalKeyEventHandler } from "./terminalKeyHandler";
import { LocalInputBookkeeping } from "./localInputBookkeeping";
import { terminalPreviewLinks } from "../../preview/terminalLinks";
import { usePreviewStore } from "../../preview/previewStore";

interface UsePTYOptions {
  sessionId: string;
  projectDir: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  activated: boolean;
  restoreChoice: "pending" | "ask" | "resume" | "fresh" | "continue";
  modeChoice: "normal" | "yolo" | null;
  generation: number;
  isVisible: boolean;
  jumpRef: React.RefObject<(dir: "prev" | "next") => void>;
  onSpawned: (spawned: boolean) => void;
  onInputError?: () => void;
  spawned: boolean;
  sessionType?: "claude" | "terminal";
  t: ReturnType<typeof import("../../../i18n/i18n").useT>;
}

interface UsePTYResult {
  termRef: React.RefObject<XTerm | null>;
  fitRef: React.RefObject<FitAddon | null>;
  searchRef: React.RefObject<SearchAddon | null>;
  serializeRef: React.RefObject<SerializeAddon | null>;
  spawnedRef: React.RefObject<boolean>;
}

/**
 * PTY lifecycle hook — manages xterm terminal, PTY spawn/kill,
 * event listening, and input forwarding.
 *
 * Delegates scrollback persistence to useScrollback.
 * Session state detection is handled globally in store.ts.
 */
export function usePTY(opts: UsePTYOptions): UsePTYResult {
  const {
    sessionId, projectDir, containerRef, activated,
    restoreChoice, modeChoice, generation, isVisible,
    jumpRef, onSpawned, onInputError, spawned, sessionType, t,
  } = opts;

  const isTerminalSession = sessionType === "terminal";

  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const serializeRef = useRef<SerializeAddon | null>(null);
  const spawnedRef = useRef(false);
  const unlistenRef = useRef<(() => void) | null>(null);

  // --- Sub-hooks (self-contained lifecycle) ---
  const saveScrollbackRef = useScrollback(termRef, serializeRef, sessionId, spawned);

  // --- Initialize terminal + spawn PTY ---
  useEffect(() => {
    if (!containerRef.current || !activated) return;
    if (restoreChoice === "pending" || restoreChoice === "ask") return;
    if (modeChoice === null) return;

    // "resume" restores scrollback AND uses --resume.
    // "continue" (mode toggle) only uses --resume — clean terminal, kept context.
    const shouldRestoreScrollback = restoreChoice === "resume";
    const shouldResumeSession = restoreChoice === "resume" || restoreChoice === "continue";
    const storeState = useStore.getState();
    const currentTheme = THEMES[storeState.settings.theme] ?? THEMES["orbit"];

    const term = new XTerm({
      theme: currentTheme.terminal,
      fontFamily: "'JetBrains Mono', 'Fira Mono', monospace",
      fontSize: storeState.settings.fontSize,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 10000,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    const search = new SearchAddon();
    const serialize = new SerializeAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(serialize);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;
    serializeRef.current = serialize;

    // Register clickable file path link provider
    term.registerLinkProvider({
      provideLinks(bufferLineNumber, callback) {
        const line = term.buffer.active.getLine(bufferLineNumber - 1);
        if (!line) { callback(undefined); return; }
        const text = line.translateToString();
        const links = terminalPreviewLinks(text);

        callback(links.map((l) => ({
          range: {
            start: { x: l.startIndex + 1, y: bufferLineNumber },
            end: { x: l.startIndex + l.length + 1, y: bufferLineNumber },
          },
          text: text.substring(l.startIndex, l.startIndex + l.length),
          activate(event) {
            const state = useStore.getState();
            if (l.target.type === "file" && (event.metaKey || event.ctrlKey)) {
              void terminal.openInEditor(state.settings.editor, l.target.path, l.line ?? 0, projectDir);
            } else {
              const project = state.projects.find(p => p.sessions.some(s => s.id === sessionId));
              if (project) usePreviewStore.getState().dispatch(project.id, l.target);
            }
          },
        })));
      },
    });

    let cancelled = false;
    const sid = sessionId;
    const generationId = crypto.randomUUID();
    let processExited = false;
    let exitUnlisten: (() => void) | null = null;
    let inputErrorUnlisten: (() => void) | null = null;
    let lastCostUpdate = 0;
    const telemetryType = isTerminalSession ? "terminal" : "agent";
    let spawnedAt: number | null = null;
    let resumeAttempted = false;
    let resumeConfirmed = false;
    let errorCode = "listener_failed";
    let localUnlisten: (() => void) | null = null;
    let stateUnlisten: (() => void) | null = null;
    let activityStart: number | null = null;
    const endActivity = (outcome: "idle" | "waiting" | "interrupted") => {
      if (activityStart === null) return;
      trackEvent("agent_activity_ended", {
        sessionType: "agent", signal: "session_hook", outcome,
        durationMs: Math.max(0, performance.now() - activityStart),
      });
      activityStart = null;
    };

    (async () => {
      try {
        // Rust spawn_pty auto-kills any existing PTY for this session_id (mode toggle, reset)

        // Restore scrollback if user chose "resume"
        if (shouldRestoreScrollback) {
          try {
            const saved = await scrollback.load(sid);
            if (saved) term.write(saved);
          } catch (err) { import("../../../lib/logger").then(({ logger }) => logger.warn("pty", `scrollback restore failed: ${err}`)); }
        } else if (restoreChoice === "fresh") {
          scrollback.clear(sid);
        }

        if (cancelled) return;
        const dims = fit.proposeDimensions();
        const cols = dims?.cols ?? 80;
        const rows = dims?.rows ?? 24;

        const storeNow = useStore.getState();
        let claudeSessionId: string | undefined;
        let sessionName: string | undefined;
        for (const p of storeNow.projects) {
          const s = p.sessions.find((s) => s.id === sid);
          if (s) {
            claudeSessionId = s.claudeSessionId;
            sessionName = s.name;
            break;
          }
        }

        // Register listener BEFORE spawn — captures all output including early bytes.
        // Generation IDs reject stale output without dropping the first bytes.
        const unlisten = await listen<{ session_id: string; generation_id?: string; data: string }>(
          "pty-output",
          (payload) => {
            if (cancelled || processExited) return;
            if (payload.session_id !== sid) return;
            if (payload.generation_id !== undefined && payload.generation_id !== generationId) return;

            term.write(payload.data);

            // Shell output is not agent spend. Avoid ANSI/regex work for the
            // common case of output without currency; retain the cost throttle.
            const now = Date.now();
            if (!isTerminalSession && payload.data.includes("$") && now - lastCostUpdate > 1000) {
              const clean = stripAnsi(payload.data);
              const costMatches = clean.match(/\$(\d+\.\d{2})/g);
              const cost = costMatches ? parseFloat(costMatches[costMatches.length - 1].slice(1)) || null : null;
              if (cost !== null) {
                lastCostUpdate = now;
                useStore.getState().updateSessionCost(sid, cost);
              }
            }
          }
        );
        if (cancelled) { unlisten(); return; }
        localUnlisten = unlisten;
        unlistenRef.current = unlisten;
        const stopListening = await listen<{ session_id: string; generation_id?: string; exit_code: number | null }>("pty-exit", (payload) => {
          if (cancelled || payload.session_id !== sid || (payload.generation_id !== undefined && payload.generation_id !== generationId)) return;
          processExited = true;
          spawnedRef.current = false;
          endActivity("interrupted");
          onSpawned(false);
          if (payload.exit_code !== 0) {
            useStore.getState().setSessionRuntimeStatus(sid, "failed", resumeAttempted ? "resume" : "spawn");
            if (resumeAttempted) trackEvent("session_resume_failed", { sessionType: telemetryType, errorCode: "process_exited" });
          } else {
            useStore.getState().setSessionRuntimeStatus(sid, "exited");
          }
        });
        if (cancelled) { stopListening(); return; }
        exitUnlisten = stopListening;
        const stopInputErrors = await listen<{ session_id: string; generation_id?: string }>("pty-input-error", (payload) => {
          if (cancelled || processExited || payload.session_id !== sid) return;
          if (payload.generation_id !== undefined && payload.generation_id !== generationId) return;
          onInputError?.();
        });
        if (cancelled) { stopInputErrors(); return; }
        inputErrorUnlisten = stopInputErrors;
        errorCode = "spawn_failed";
        trackEvent("pty_spawn_attempted", { sessionType: telemetryType });

        // Spawn PTY — Rust auto-kills previous for same session_id
        if (isTerminalSession) {
          await pty.spawn({
            sessionId: sid,
            projectDir,
            cols,
            rows,
            shellOnly: true,
            generationId,
          });
        } else {
          const isResume = shouldResumeSession && !!claudeSessionId;
          const effectiveClaudeId = isResume
            ? claudeSessionId!
            : crypto.randomUUID();

          resumeAttempted = isResume;
          if (isResume) trackEvent("session_resume_attempted", { sessionType: telemetryType });
          await pty.spawn({
            sessionId: sid,
            projectDir,
            cols,
            rows,
            claudeSessionId: effectiveClaudeId,
            resumeMode: isResume,
            sessionName: sessionName || null,
            dangerousMode: modeChoice === "yolo",
            generationId,
          });

          if (cancelled) { await pty.kill(sid, generationId); return; }
          if (!isResume) {
            useStore.getState().setClaudeSessionId(sid, effectiveClaudeId);
          }
          useStore.getState().setDangerousMode(sid, modeChoice === "yolo");
        }

        // These events confirm spawn_pty resolved, NOT Claude's acceptance of
        // the conversation or a successful business task (no reliable handshake).
        if (cancelled) { await pty.kill(sid, generationId); return; }
        spawnedAt = performance.now();
        spawnedRef.current = !processExited;
        if (!processExited) {
          fit.fit();
          const currentDims = fit.proposeDimensions();
          if (currentDims) pty.resize(sid, currentDims.cols, currentDims.rows).catch(() => {});
          onSpawned(true);
          useStore.getState().setSessionRuntimeStatus(sid, "running");
        }
        trackEvent("pty_spawned", { restore: resumeAttempted ? 1 : 0, sessionType: telemetryType });
        if (resumeAttempted && !processExited) trackEvent("session_resume_launched", { sessionType: telemetryType });

        // Only structured session hooks can establish an observed activity
        // interval. PTY text/Enter/working->idle cannot prove business success.
        // No initial-state guess: an unmatched idle is deliberately ignored.
        if (!isTerminalSession) {
          void listen<string>("session-state-changed", (raw) => {
            if (cancelled) return;
            try {
              const data = JSON.parse(raw);
              const current = useStore.getState().projects.flatMap(p => p.sessions).find(s => s.id === sid);
              if (!current?.claudeSessionId || data.session_id !== current.claudeSessionId) return;
              if (resumeAttempted && !resumeConfirmed && data.state === "working") {
                resumeConfirmed = true;
                trackEvent("session_resume_succeeded", { sessionType: telemetryType });
              }
              if (data.state === "working" && activityStart === null) {
                activityStart = performance.now();
                trackEvent("agent_activity_started", { sessionType: "agent", signal: "session_hook" });
              } else if (data.state === "idle" || data.state === "waiting") {
                endActivity(data.state);
              }
            } catch { /* malformed hook: never inspect or emit raw data */ }
          }).then(fn => { if (cancelled) fn(); else stateUnlisten = fn; }).catch(() => {});
        }

        // Input is used locally for conversation/title bookkeeping only. Enter
        // is not proof of an agent prompt: it may be vim, permission UI, etc.
        const input = new LocalInputBookkeeping();
        let titleGenerated = false;
        term.onData((data) => {
          if (cancelled || processExited) return;
          pty.write(sid, data).catch(() => {
            if (!cancelled && !processExited) onInputError?.();
          });
          for (const prompt of input.feed(data)) {
            if (!isTerminalSession && prompt.length > 0) useStore.getState().markConversationStarted(sid);
            if (!titleGenerated && !isTerminalSession && prompt.length > 3 && (sessionName === "main" || /^session-\d+$/.test(sessionName ?? ""))) {
              titleGenerated = true;
              claude.generateTitle(prompt).then((title) => {
                const current = useStore.getState().projects.flatMap((p) => p.sessions).find((s) => s.id === sid);
                if (!cancelled && !processExited && current?.name === sessionName) useStore.getState().renameSession(sid, title);
              }).catch(() => {});
            }
          }
        });

        term.attachCustomKeyEventHandler?.(
          createTerminalKeyEventHandler({
            sid,
            term,
            pty,
            jumpPrompt: (dir) => jumpRef.current(dir),
            writeText,
            readText,
            onInputError: () => { if (!cancelled && !processExited) onInputError?.(); },
          }),
        );
      } catch (err) {
        // Ensure listener is cleaned up even if spawn failed
        inputErrorUnlisten?.();
        inputErrorUnlisten = null;
        exitUnlisten?.();
        exitUnlisten = null;
        localUnlisten?.();
        if (unlistenRef.current === localUnlisten) unlistenRef.current = null;
        localUnlisten = null;
        if (!cancelled) {
          spawnedRef.current = false;
          onSpawned(false);
          useStore.getState().setSessionRuntimeStatus(sid, "failed", resumeAttempted ? "resume" : "spawn");
          const errMsg = err instanceof Error ? err.message : String(err);
          term.write(`\r\n\x1b[31m${t("terminal.error", { message: errMsg })}\x1b[0m\r\n`);
          trackEvent("pty_error", { errorCode, sessionType: telemetryType });
          if (resumeAttempted) trackEvent("session_resume_failed", { sessionType: telemetryType, errorCode });
        }
      }
    })();

    return () => {
      cancelled = true;
      endActivity("interrupted");
      stateUnlisten?.();
      inputErrorUnlisten?.();
      exitUnlisten?.();
      spawnedRef.current = false;
      onSpawned(false);

      // Mounted PTY lifetime is not agent/task duration. Start only after
      // spawn resolves; use a monotonic clock (wall clock may change).
      if (spawnedAt !== null) trackEvent("pty_lifetime", {
        durationMs: Math.max(0, performance.now() - spawnedAt), sessionType: telemetryType,
      });

      localUnlisten?.();
      if (unlistenRef.current === localUnlisten) unlistenRef.current = null;
      localUnlisten = null;

      // Do NOT kill the PTY here — Rust spawn_pty auto-kills previous session.
      // PTY is also killed by store.removeSession when user explicitly deletes.

      // Guard: term may already be disposed if React unmounts during cascade
      saveScrollbackRef.current();
      try { term.dispose(); } catch { /* already disposed */ }
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
      serializeRef.current = null;
    };
  }, [sessionId, projectDir, activated, restoreChoice, modeChoice, generation]);

  // --- Resize handling ---
  useEffect(() => {
    if (!isVisible || !containerRef.current) return;

    const doFit = () => {
      const fit = fitRef.current;
      if (!fit) return;
      fit.fit();
      const dims = fit.proposeDimensions();
      if (dims && spawnedRef.current) {
        pty.resize(sessionId, dims.cols, dims.rows).catch(() => {});
      }
    };

    const timer = setTimeout(doFit, 50);
    let resizeTimer = 0;
    const debouncedFit = () => { clearTimeout(resizeTimer); resizeTimer = window.setTimeout(doFit, 100); };
    window.addEventListener("resize", debouncedFit);
    const observer = new ResizeObserver(debouncedFit);
    observer.observe(containerRef.current);

    return () => {
      clearTimeout(timer);
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", debouncedFit);
      observer.disconnect();
    };
  }, [isVisible, sessionId]);

  // --- React to theme changes ---
  const themeName = useStore((s) => s.settings.theme);
  useEffect(() => {
    if (!termRef.current) return;
    const t = THEMES[themeName] ?? THEMES["orbit"];
    termRef.current.options.theme = t.terminal;
  }, [themeName]);

  // --- React to font size changes ---
  const fontSize = useStore((s) => s.settings.fontSize);
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.fontSize = fontSize;
    fitRef.current?.fit();
    const dims = fitRef.current?.proposeDimensions();
    if (dims && spawnedRef.current) {
      pty.resize(sessionId, dims.cols, dims.rows).catch(() => {});
    }
  }, [fontSize]);

  return { termRef, fitRef, searchRef, serializeRef, spawnedRef };
}
