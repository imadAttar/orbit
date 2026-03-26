import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { useStore } from "../../../core/store";
import { THEMES } from "../../../lib/themes";
import { stripAnsi } from "../../../lib/terminalParser";
import { trackEvent } from "../../../lib/analytics";
import { logger } from "../../../lib/logger";
import { pty, terminal, scrollback, listen } from "../../../core/api";
import { useScrollback } from "./useScrollback";
import { useSessionStatePoller } from "../../../hooks/useSessionStatePoller";

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
 * Delegates scrollback persistence to useScrollback
 * and session state polling to useSessionStatePoller.
 */
export function usePTY(opts: UsePTYOptions): UsePTYResult {
  const {
    sessionId, projectDir, containerRef, activated,
    restoreChoice, modeChoice, generation, isVisible,
    jumpRef, onSpawned, spawned, t,
  } = opts;

  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const serializeRef = useRef<SerializeAddon | null>(null);
  const spawnedRef = useRef(false);
  const unlistenRef = useRef<(() => void) | null>(null);

  // --- Sub-hooks (self-contained lifecycle) ---
  useScrollback(termRef, serializeRef, sessionId, spawned);
  useSessionStatePoller(sessionId, projectDir, spawned);

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

    (async () => {
      try {
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

        // For fresh sessions, generate a UUID upfront and pass it via --session-id
        // so each tab gets its own isolated Claude session deterministically.
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

        // Store the Claude session ID immediately — no async detection needed
        if (!isResume) {
          useStore.getState().setClaudeSessionId(sid, effectiveClaudeId);
        }

        useStore.getState().setDangerousMode(sid, modeChoice === "yolo");

        spawnedRef.current = true;
        onSpawned(true);
        trackEvent("pty_spawned", { restore: shouldRestore ? 1 : 0 });

        // Listen for PTY output
        const unlisten = await listen<{ session_id: string; data: string }>(
          "pty-output",
          (payload) => {
            if (cancelled) return;
            if (payload.session_id !== sid) return;

            term.write(payload.data);

            const clean = stripAnsi(payload.data);
            const costMatches = clean.match(/\$(\d+\.\d{2})/g);
            const cost = costMatches ? parseFloat(costMatches[costMatches.length - 1].slice(1)) || null : null;
            if (cost !== null) {
              useStore.getState().updateSessionCost(sid, cost);
            }
          }
        );
        unlistenRef.current = unlisten;

        // Forward xterm input to PTY
        term.onData((data) => {
          pty.write(sid, data).catch(() => {});
        });

        // Prompt navigation — intercept Cmd+Up/Down before xterm
        term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
          if ((e.metaKey || e.ctrlKey) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            e.stopPropagation();
            jumpRef.current(e.key === "ArrowUp" ? "prev" : "next");
            return false;
          }
          return true;
        });
      } catch (err) {
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
      unlistenRef.current?.();
      unlistenRef.current = null;

      pty.kill(sid).catch((err: unknown) => {
        logger.warn("terminal", `kill_pty failed: ${err}`);
      });

      term.dispose();
      termRef.current = null;
      fitRef.current = null;
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
    window.addEventListener("resize", doFit);
    const observer = new ResizeObserver(() => doFit());
    observer.observe(containerRef.current);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", doFit);
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
