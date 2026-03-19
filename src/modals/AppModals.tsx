import { useState } from "react";
import type { Session } from "../core/types";
import { useStore } from "../core/store";
import { claude, statusline } from "../core/api";
import { trackEvent } from "../lib/analytics";
import { useT } from "../i18n/i18n";

// --- Statusline Prompt ---

export function StatuslineModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const dismiss = () => { onClose(); useStore.getState().setStatuslineAsked(); };
  return (
    <div className="modal-overlay" role="presentation" onClick={dismiss} onKeyDown={(e) => { if (e.key === "Escape") dismiss(); }}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <div className="modal__title">{t("statusline.title")}</div>
        <div className="modal__body">{t("statusline.message")}</div>
        <div className="modal__hint">{t("statusline.hint")}</div>
        <div className="modal__actions">
          <button className="modal__btn--secondary" onClick={dismiss}>{t("statusline.decline")}</button>
          <button className="modal__btn--primary" onClick={async () => {
            try { await statusline.create(); trackEvent("statusline_created"); } catch { /* ignore */ }
            dismiss();
          }}>{t("statusline.install")}</button>
        </div>
      </div>
    </div>
  );
}

// --- Delete Session Confirm ---

interface DeleteSessionProps {
  sessionId: string;
  sessions: Session[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteSessionModal({ sessionId, sessions, onConfirm, onCancel }: DeleteSessionProps) {
  const t = useT();
  const session = sessions.find((s) => s.id === sessionId);
  return (
    <div className="modal-overlay" role="presentation" onClick={onCancel} onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <div className="modal__title">{t("session.delete")}</div>
        <div className="modal__body">{t("session.deleteConfirm", { name: session?.name ?? "" })}</div>
        <div className="modal__actions">
          <button className="modal__btn--secondary" onClick={onCancel}>{t("common.cancel")}</button>
          <button className="modal__btn--danger" onClick={onConfirm}>{t("common.delete")}</button>
        </div>
      </div>
    </div>
  );
}

// --- Install Claude ---

interface InstallClaudeProps {
  onClose: () => void;
}

export function InstallClaudeModal({ onClose }: InstallClaudeProps) {
  const t = useT();
  const [status, setStatus] = useState<"idle" | "installing" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <div className="modal__title">{t("claude.notDetected")}</div>
        <div className="modal__body">
          {status === "idle" && t("claude.notInstalledMessage")}
          {status === "installing" && <span className="modal__hint">{t("claude.installing")}</span>}
          {status === "success" && <span className="modal__status--success">{message}</span>}
          {status === "error" && <span className="modal__status--error">{message}</span>}
        </div>
        {status === "idle" && <div className="modal__hint">{t("claude.installHint")}</div>}
        <div className="modal__actions">
          {status === "idle" && (
            <>
              <button className="modal__btn--secondary" onClick={onClose}>{t("claude.later")}</button>
              <button className="modal__btn--primary" onClick={async () => {
                setStatus("installing");
                try {
                  const msg = await claude.install();
                  setStatus("success"); setMessage(msg); trackEvent("claude_installed");
                } catch (err) {
                  setStatus("error"); setMessage(err instanceof Error ? err.message : String(err));
                }
              }}>{t("claude.install")}</button>
            </>
          )}
          {status === "installing" && <button className="modal__btn--secondary" disabled>{t("claude.installingBtn")}</button>}
          {(status === "success" || status === "error") && (
            <button className="modal__btn--primary" onClick={onClose}>
              {status === "success" ? t("claude.start") : t("common.close")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
