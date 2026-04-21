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

// File path regex for xterm link provider
const FILE_PATH_RE = /((?:\/|\.\/|\.\.\/|[a-zA-Z]:\\)[\w.\/_\\-]+(?:\.[a-zA-Z0-9]+))(?::(\d+))?(?::(\d+))?/;

interface UsePTYOptions {
  sessionId: string;
  projectDir: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  activated: boolean;
  restoreChoice: "pending" | "ask" | "resume" | "fresh";
  modeChoice: "normal" | "yolo" | null;
  generation: number;
  isVisible: boolean;
  jumpRef: React.RefObject<(dir: "prev" | "next") => void>;
  onSpawned: (spawned: boolean) => void;
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
    jumpRef, onSpawned, spawned, sessionType, t,
  } = opts;

  const isTerminalSession = sessionType === "terminal";

  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const serializeRef = useRef<SerializeAddon | null>(null);
  const spawnedRef = useRef(false);
  const unlistenRef = useRef<(() => void) | null>(null);

  // --- Sub-hooks (self-contained lifecycle) ---
  useScrollback(termRef, serializeRef, sessionId, spawned);

  // --- Initialize terminal + spawn PTY ---
  useEffect(() => {
    if (!containerRef.current || !activated) return;
    if (restoreChoice === "pending" || restoreChoice === "ask") return;
    if (modeChoice === null) return;

    const shouldRestore = restoreChoice === "resume";
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
        const links: { startIndex: number; length: number; data: { path: string; line?: number; col?: number } }[] = [];

        let match;
        const re = new RegExp(FILE_PATH_RE.source, "g");
        while ((match = re.exec(text)) !== null) {
          links.push({
            startIndex: match.index,
            length: match[0].length,
            data: {
              path: match[1],
              line: match[2] ? parseInt(match[2]) : undefined,
              col: match[3] ? parseInt(match[3]) : undefined,
            },
          });
        }

        callback(links.map((l) => ({
          range: {
            start: { x: l.startIndex + 1, y: bufferLineNumber },
            end: { x: l.startIndex + l.length + 1, y: bufferLineNumber },
          },
          text: text.substring(l.startIndex, l.startIndex + l.length),
          activate() {
            const editor = useStore.getState().settings.editor;
            terminal.openInEditor(editor, l.data.path, l.data.line ?? 0, projectDir);
            trackEvent("file_opened_from_terminal");
          },
        })));
      },
    });

    let cancelled = false;
    const sid = sessionId;
    let lastCostUpdate = 0;
    let promptCount = 0;
    const sessionStartTime = Date.now();

    (async () => {
      try {
        // Rust spawn_pty auto-kills any existing PTY for this session_id (mode toggle, reset)

        // Restore scrollback if user chose "resume"
        if (shouldRestore) {
          try {
            const saved = await scrollback.load(sid);
            if (saved) term.write(saved);
          } catch (err) { import("../../../lib/logger").then(({ logger }) => logger.warn("pty", `scrollback restore failed: ${err}`)); }
        } else {
          scrollback.clear(sid);
        }

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
        // spawnComplete flag ignores stale events from previous PTY (Rust kills it in spawn_pty).
        let spawnComplete = false;
        const unlisten = await listen<{ session_id: string; data: string }>(
          "pty-output",
          (payload) => {
            if (cancelled || !spawnComplete) return;
            if (payload.session_id !== sid) return;

            term.write(payload.data);

            // Throttle cost extraction to max 1/sec
            const now = Date.now();
            if (now - lastCostUpdate > 1000) {
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
        unlistenRef.current = unlisten;

        // Spawn PTY — Rust auto-kills previous for same session_id
        if (isTerminalSession) {
          await pty.spawn({
            sessionId: sid,
            projectDir,
            cols,
            rows,
            shellOnly: true,
          });
        } else {
          const isResume = shouldRestore && !!claudeSessionId;
          const effectiveClaudeId = isResume
            ? claudeSessionId!
            : crypto.randomUUID();

          await pty.spawn({
            sessionId: sid,
            projectDir,
            cols,
            rows,
            claudeSessionId: effectiveClaudeId,
            resumeMode: isResume,
            sessionName: sessionName || null,
            dangerousMode: modeChoice === "yolo",
          });

          if (!isResume) {
            useStore.getState().setClaudeSessionId(sid, effectiveClaudeId);
          }
          useStore.getState().setDangerousMode(sid, modeChoice === "yolo");
        }

        // Now accept events from the new PTY
        spawnComplete = true;
        spawnedRef.current = true;
        onSpawned(true);
        trackEvent("pty_spawned", { restore: shouldRestore ? 1 : 0 });

        // Forward xterm input to PTY
        let lastPromptTrack = 0;
        let inputBuffer = "";
        let titleGenerated = false;
        term.onData((data) => {
          pty.write(sid, data).catch(() => {});
          // Track Enter key — throttle to max 1 event per 2s to avoid noise from vim/less/confirmations
          if (data === "\r" || data === "\n") {
            const now = Date.now();
            if (now - lastPromptTrack > 2000) {
              lastPromptTrack = now;
              promptCount++;
              trackEvent("prompt_sent");
            }
            // Auto-title: generate on first meaningful prompt
            if (!titleGenerated && !isTerminalSession && inputBuffer.trim().length > 3) {
              titleGenerated = true;
              const prompt = inputBuffer.trim();
              claude.generateTitle(prompt).then((title) => {
                useStore.getState().renameSession(sid, title);
              }).catch(() => {});
            }
            inputBuffer = "";
          } else if (!titleGenerated) {
            // Accumulate typed characters (ignore control chars)
            if (data.length === 1 && data.charCodeAt(0) >= 32) {
              inputBuffer += data;
            } else if (data === "\x7f") {
              inputBuffer = inputBuffer.slice(0, -1);
            }
          }
        });

        term.attachCustomKeyEventHandler(
          createTerminalKeyEventHandler({
            sid,
            term,
            pty,
            jumpPrompt: (dir) => jumpRef.current(dir),
            writeText,
            readText,
          }),
        );
      } catch (err) {
        // Ensure listener is cleaned up even if spawn failed
        if (unlistenRef.current) {
          unlistenRef.current();
          unlistenRef.current = null;
        }
        if (!cancelled) {
          const errMsg = err instanceof Error ? err.message : String(err);
          term.write(`\r\n\x1b[31m${t("terminal.error", { message: errMsg })}\x1b[0m\r\n`);
          trackEvent("pty_error", { error: errMsg.slice(0, 100) });
        }
      }
    })();

    return () => {
      cancelled = true;
      spawnedRef.current = false;
      onSpawned(false);

      // Track session engagement metrics on cleanup
      if (promptCount > 0) {
        const durationMs = Date.now() - sessionStartTime;
        const cost = useStore.getState().sessionCosts[sid] ?? 0;
        trackEvent("session_engagement", {
          prompts: promptCount,
          durationMs,
          durationMin: Math.round(durationMs / 60000),
          cost,
          sessionType: isTerminalSession ? "terminal" : "claude",
        });
      }

      // Unlisten may still be pending (async) — handle both cases
      if (unlistenRef.current) {
        unlistenRef.current();
      }
      unlistenRef.current = null;

      // Do NOT kill the PTY here — Rust spawn_pty auto-kills previous session.
      // PTY is also killed by store.removeSession when user explicitly deletes.

      // Guard: term may already be disposed if React unmounts during cascade
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
  }, [fontSize]);

  return { termRef, fitRef, searchRef, serializeRef, spawnedRef };
}
