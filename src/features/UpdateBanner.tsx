import { useMemo } from "react";
import type { UpdateStatus } from "./updater";
import { triggerManualUpdate, installAndRestart } from "./updater";
import { useT } from "../i18n/i18n";

interface Props {
  status: UpdateStatus;
}

export default function UpdateBanner({ status }: Props) {
  const t = useT();
  const progress = status.state === "downloading" ? status.progress : 0;
  const progressStyle = useMemo(() => ({ width: `${progress}%` }), [progress]);

  if (status.state === "idle") return null;

  if (status.state === "available") {
    return (
      <div className="update-banner">
        <span>{t("update.available", { version: status.version ?? "" })}</span>
        <button className="update-banner__btn" onClick={triggerManualUpdate}>{t("update.download")}</button>
      </div>
    );
  }

  if (status.state === "downloading") {
    return (
      <div className="update-banner">
        <span>{t("update.downloading", { progress: status.progress ?? 0 })}</span>
        <div className="update-banner__progress">
          <div className="update-banner__bar" style={progressStyle} />
        </div>
      </div>
    );
  }

  if (status.state === "ready") {
    return (
      <div className="update-banner update-banner--ready">
        <span>{t("update.ready", { version: status.version ?? "" })}</span>
        <button className="update-banner__btn" onClick={installAndRestart}>{t("update.restart")}</button>
      </div>
    );
  }

  if (status.state === "error") {
    return (
      <div className="update-banner update-banner--error">
        <span>{t("update.error", { message: status.message ?? "" })}</span>
      </div>
    );
  }

  return null;
}
