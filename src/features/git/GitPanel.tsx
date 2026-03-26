import { useReducer, useEffect, useRef } from "react";
import { useStore } from "../../core/store";
import { git } from "../../core/api";
import { trackEvent } from "../../lib/analytics";
import { useT } from "../../i18n/i18n";

type GitStatus = "idle" | "committing" | "pushing" | "done" | "error";

interface GitState {
  status: GitStatus;
  commitMsg: string;
  error: string;
}

type GitAction =
  | { type: "setMsg"; value: string }
  | { type: "startCommit" }
  | { type: "startPush" }
  | { type: "success" }
  | { type: "fail"; error: string }
  | { type: "reset" };

function gitReducer(state: GitState, action: GitAction): GitState {
  switch (action.type) {
    case "setMsg": return { ...state, commitMsg: action.value };
    case "startCommit": return { ...state, status: "committing", error: "" };
    case "startPush": return { ...state, status: "pushing" };
    case "success": return { ...state, status: "done" };
    case "fail": return { ...state, status: "error", error: action.error };
    case "reset": return { ...state, status: "idle", error: "" };
    default: return state;
  }
}

export default function GitPanel() {
  const showGitPanel = useStore((s) => s.showGitPanel);
  const gitDiff = useStore((s) => s.gitDiff);
  const gitFiles = useStore((s) => s.gitFiles);
  const proposedCommitMessage = useStore((s) => s.proposedCommitMessage);
  const setShowGitPanel = useStore((s) => s.setShowGitPanel);
  const t = useT();
  const [gs, dp] = useReducer(gitReducer, { status: "idle", commitMsg: proposedCommitMessage, error: "" });
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (gs.status === "idle") dp({ type: "setMsg", value: proposedCommitMessage });
  }, [proposedCommitMessage, gs.status]);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  if (!showGitPanel) return null;

  const getProjectDir = () => {
    const state = useStore.getState();
    const proj = state.projects.find((p) => p.id === state.activePid);
    return proj?.dir ?? "";
  };

  const handleCommit = async (andPush = false) => {
    dp({ type: "startCommit" });
    try {
      const projectDir = getProjectDir();
      await git.commit(projectDir, gs.commitMsg);
      trackEvent("git_commit", { files: gitFiles.length });
      if (andPush) {
        dp({ type: "startPush" });
        await git.push(projectDir);
        trackEvent("git_push");
      }
      dp({ type: "success" });
      successTimerRef.current = setTimeout(() => {
        const store = useStore.getState();
        store.setShowGitPanel(false);
        store.setGitFiles([]);
        store.setGitDiff("");
        store.setProposedCommitMessage("");
        dp({ type: "reset" });
        successTimerRef.current = null;
      }, 2500);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      dp({ type: "fail", error: errMsg });
      trackEvent("git_error", { error: errMsg.slice(0, 100) });
    }
  };

  return (
    <div className="git-panel">
      <div className="git-panel__header">
        <span className="git-panel__title">{t("git.header", { count: gitFiles.length })}</span>
        <button className="search-bar__btn" onClick={() => { setShowGitPanel(false); trackEvent("git_panel_closed"); }} title={t("common.close")}>
          &#x2715;
        </button>
      </div>
      <div className="git-panel__files">
        {gitFiles.map((f) => (
          <div key={f} className="git-panel__file">
            <span className="git-panel__file-status">{f.slice(0, 2)}</span>
            <span className="git-panel__file-name">{f.slice(3)}</span>
          </div>
        ))}
      </div>
      {gitDiff && (
        <details className="git-panel__diff-toggle">
          <summary>{t("git.viewDiff")}</summary>
          <pre className="git-panel__diff">{gitDiff.slice(0, 3000)}</pre>
        </details>
      )}
      <div className="git-panel__commit">
        <textarea
          className="git-panel__commit-input"
          value={gs.commitMsg}
          onChange={(e) => dp({ type: "setMsg", value: e.target.value })}
          placeholder={t("git.commitPlaceholder")}
          rows={2}
        />
        {gs.error && <div className="git-panel__error">{gs.error}</div>}
        <div className="git-panel__actions">
          {gs.status === "idle" && (
            <>
              <button className="modal__btn--primary" onClick={() => handleCommit(false)} disabled={!gs.commitMsg.trim()}>
                {t("git.commit")}
              </button>
              <button className="modal__btn--primary" onClick={() => handleCommit(true)} disabled={!gs.commitMsg.trim()}>
                {t("git.commitPush")}
              </button>
            </>
          )}
          {gs.status === "committing" && <span className="git-panel__status--progress">{t("git.committing")}</span>}
          {gs.status === "pushing" && <span className="git-panel__status--progress">{t("git.pushing")}</span>}
          {gs.status === "done" && <span className="git-panel__status--success">{t("git.success")}</span>}
          {gs.status === "error" && (
            <button className="modal__btn--primary" onClick={() => dp({ type: "reset" })}>
              {t("common.retry")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
