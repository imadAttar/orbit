import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useStore } from "../core/store";
import { THEMES } from "../lib/themes";
import { pty, orbit, listen } from "../core/api";
import { trackEvent } from "../lib/analytics";
import { useT } from "../i18n/i18n";

const PROMPT_FILE = "coach-prompt.txt";

interface Props {
  onSend: (prompt: string) => void;
  onClose: () => void;
}

export default function PromptCoach({ onSend, onClose }: Props) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const [spawned, setSpawned] = useState(false);
  const [validating, setValidating] = useState(false);
  const [coachTimeout, setCoachTimeout] = useState(false);
  const sessionIdRef = useRef(`coach-${Date.now()}`);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const themeName = useStore((s) => s.settings.theme);
  const fontSize = useStore((s) => s.settings.fontSize);
  const activeProject = useStore((s) => s.projects.find((p) => p.id === s.activePid));

  useEffect(() => {
    if (!containerRef.current || !activeProject) return;

    const theme = THEMES[themeName] ?? THEMES["orbit"];
    const term = new XTerm({
      theme: theme.terminal,
      fontSize,
      fontFamily: "'JetBrains Mono', 'Fira Mono', monospace",
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;

    const sid = sessionIdRef.current;
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    (async () => {
      try {
        await pty.spawn({
          sessionId: sid,
          projectDir: activeProject.dir,
          cols: term.cols,
          rows: term.rows,
          claudeSessionId: null,
          sessionName: "coach",
          dangerousMode: false,
        });

        if (cancelled) return;
        setSpawned(true);

        // Wait for the prompt to be ready before auto-launching the skill
        let launched = false;
        unlistenFn = await listen<{ session_id: string; data: string }>(
          "pty-output",
          (payload) => {
            if (payload.session_id !== sid) return;
            term.write(payload.data);

            // Detect Claude Code ready prompt (ends with "> " or "❯ " or "$ ")
            if (!launched && !cancelled && /[>❯$]\s*$/.test(payload.data)) {
              launched = true;
              pty.write(sid, "/ai-fluency-4d-coach\r").catch(() => {});
            }
          },
        );

        term.onData((data) => {
          pty.write(sid, data).catch(() => {});
        });

      } catch (err) {
        import("../lib/logger").then(({ logger }) => logger.error("coach", `Spawn error: ${err}`));
      }
    })();

    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(containerRef.current);

    return () => {
      cancelled = true;
      ro.disconnect();
      unlistenFn?.();
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      pty.killSilent(sid);
      term.dispose();
    };
  }, [activeProject?.dir, themeName, fontSize]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleValidate = useCallback(async () => {
    if (!spawned || validating) return;
    setValidating(true);
    trackEvent("coach_validate");

    try {
      const sid = sessionIdRef.current;

      // Tell Claude to write the final prompt to a file
      await pty.write(sid, `${t("coach.writeInstruction")}\r`);

      // Poll the file until it appears
      const startTime = Date.now();
      const poll = setInterval(async () => {
        const elapsed = Date.now() - startTime;
        if (elapsed > 30000) {
          clearInterval(poll);
          pollRef.current = null;
          setValidating(false);
          setCoachTimeout(true);
          return;
        }

        try {
          const content = await orbit.readFile(PROMPT_FILE);
          if (content && content.trim().length > 5) {
            clearInterval(poll);
            pollRef.current = null;
            // Clean up the file
            orbit.writeFile(PROMPT_FILE, "").catch(() => {});
            onSend(content.trim());
            onClose();
          }
        } catch {
          // File doesn't exist yet — keep polling
        }
      }, 1500);
      pollRef.current = poll;
    } catch {
      setValidating(false);
    }
  }, [spawned, validating, onSend, onClose, t]);

  return (
    <div className="coach-slide">
      <div className="coach-slide__header">
        <span className="coach-slide__label">{t("coach.title")}</span>
        <div className="coach-slide__spacer" />
        <button
          className="coach-slide__validate"
          onClick={() => { if (coachTimeout) setCoachTimeout(false); handleValidate(); }}
          disabled={!spawned || validating}
        >
          {validating ? t("coach.waiting") : coachTimeout ? t("coach.timeout") : t("coach.validate")}
        </button>
        <button className="coach-slide__close" onClick={onClose}>
          <kbd>Esc</kbd>
        </button>
      </div>
      <div className="coach-slide__terminal" ref={containerRef} />
    </div>
  );
}
