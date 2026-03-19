import { useEffect, useRef } from "react";
import { useStore } from "../core/store";
import { git, terminal, listen } from "../core/api";
import { trackEvent } from "../lib/analytics";

/** Track previous state to detect transitions */
const prevSessionStates: Record<string, string> = {};

/** Trigger git status check after completion */
async function triggerGitCheck(projectDir: string) {
  try {
    const files = await git.status(projectDir);
    if (files && files.length > 0) {
      const store = useStore.getState();
      store.setGitFiles(files);
      const diff = await git.diff(projectDir);
      store.setGitDiff(diff || "");
      const fileNames = files.map((f) => f.replace(/^.\s+/, "")).join(", ");
      store.setProposedCommitMessage(`feat: update ${fileNames}`);
      store.setGitPending(true);
    }
  } catch { /* not a git repo */ }
}

interface SessionStateData {
  session_id: string;
  state: string;
  ts: number;
  tool?: string;
  changed_files?: string[];
}

/**
 * Session state hook — event-driven via Rust file watcher.
 * Listens to `session-state-changed` Tauri event (emitted when ~/.orbit/session-state.json changes).
 * Falls back to polling if events are unavailable (non-Tauri environment).
 */
export function useSessionStatePoller(
  sessionId: string,
  projectDir: string,
  spawned: boolean,
) {
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  useEffect(() => {
    if (!spawned) return;

    const handleStateChange = (raw: string) => {
      try {
        const data = JSON.parse(raw) as SessionStateData;
        if (!data.session_id || !data.state) return;

        const store = useStore.getState();
        let matchedSid: string | null = null;
        for (const p of store.projects) {
          const s = p.sessions.find((s) => s.claudeSessionId === data.session_id);
          if (s) { matchedSid = s.id; break; }
        }
        if (!matchedSid) return;

        const prev = prevSessionStates[data.session_id];
        if (prev === data.state) return;
        prevSessionStates[data.session_id] = data.state;

        store.setSessionState(data.session_id, data.state as "working" | "idle" | "waiting");

        if (data.tool) {
          store.setSessionTool(data.session_id, data.tool);
        }
        if (data.changed_files && data.changed_files.length > 0) {
          store.setSessionChangedFiles(data.session_id, data.changed_files);
        }

        // On transition to idle: notify + git check
        if (data.state === "idle" && prev === "working") {
          if (store.activeSid !== matchedSid) {
            store.notifySession(matchedSid);
            let name = matchedSid;
            for (const p of store.projects) {
              const s = p.sessions.find((s) => s.id === matchedSid);
              if (s) { name = `${p.name} — ${s.name}`; break; }
            }
            terminal.notifyDone(name);
            trackEvent("session_completed_background");
          }
          triggerGitCheck(projectDir);
        }
      } catch { /* malformed payload */ }
    };

    let unlisten: (() => void) | null = null;
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;

    listen<string>("session-state-changed", handleStateChange)
      .then((fn) => { unlisten = fn; })
      .catch(() => {
        // Fallback: poll if Tauri events unavailable (dev/test environment)
        const poll = async () => {
          try {
            const { orbit } = await import("../core/api");
            const raw = await orbit.readFile("session-state.json");
            if (raw) handleStateChange(raw);
          } catch { /* not available */ }
        };
        fallbackInterval = setInterval(poll, 1500);
      });

    return () => {
      unlisten?.();
      if (fallbackInterval) clearInterval(fallbackInterval);
    };
  }, [spawned, projectDir]);
}
