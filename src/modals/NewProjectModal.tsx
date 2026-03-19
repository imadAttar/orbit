import { useState } from "react";
import { useStore } from "../core/store";
import { trackEvent } from "../lib/analytics";
import { useT } from "../i18n/i18n";
import FocusTrap from "../shared/FocusTrap";

function prevDirName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || "";
}

export default function NewProjectModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [mode, setMode] = useState<"open" | "create">("open");
  const [name, setName] = useState("");
  const [dir, setDir] = useState("");
  const [parentDir, setParentDir] = useState("");
  const addProject = useStore((s) => s.addProject);

  const handlePickDir = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (selected) {
        if (mode === "open") {
          setDir(selected as string);
          const parts = (selected as string).replace(/[\\/]+$/, "").split(/[\\/]/);
          const lastSegment = parts[parts.length - 1];
          if (lastSegment && !name.trim()) {
            setName(lastSegment);
          }
        } else {
          setParentDir(selected as string);
        }
      }
    } catch {
      // Fallback: manual input
    }
  };

  const handleSubmit = async () => {
    if (mode === "open") {
      if (!name.trim() || !dir.trim()) return;
      addProject(name.trim(), dir.trim());
      trackEvent("project_created");
      onClose();
    } else {
      if (!name.trim() || !parentDir.trim()) return;
      const safeName = name.trim();
      if (/[/\\]|\.\./.test(safeName)) {
        import("../lib/logger").then(({ logger }) => logger.warn("project", "Invalid project name: forbidden characters"));
        return;
      }
      const sep = parentDir.includes("\\") ? "\\" : "/";
      const fullPath = parentDir.replace(/[\\/]+$/, "") + sep + safeName;
      try {
        const { orbit } = await import("../core/api");
        await orbit.createDirectory(fullPath);
        addProject(name.trim(), fullPath);
        trackEvent("project_created");
        onClose();
      } catch (err) {
        import("../lib/logger").then(({ logger }) => logger.error("project", `Failed to create directory: ${err}`));
      }
    }
  };

  const isValid = mode === "open"
    ? name.trim() && dir.trim()
    : name.trim() && parentDir.trim();

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <FocusTrap>
        <div className="modal__title">{t("project.new")}</div>
        <div className="modal__tabs">
          <button
            className={`modal__tab ${mode === "open" ? "modal__tab--active" : ""}`}
            onClick={() => setMode("open")}
          >
            {t("project.openFolder")}
          </button>
          <button
            className={`modal__tab ${mode === "create" ? "modal__tab--active" : ""}`}
            onClick={() => setMode("create")}
          >
            {t("app.createProject")}
          </button>
        </div>
        <label className="modal__label">
          {t("project.name")}
          <input
            className="modal__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("project.namePlaceholder")}
            ref={(el) => el?.focus()}
          />
        </label>
        {mode === "open" ? (
          <label className="modal__label">
            {t("project.directory")}
            <div className="modal__dir-row">
              <input
                className="modal__input"
                value={dir}
                onChange={(e) => {
                  const d = e.target.value;
                  setDir(d);
                  if (!name.trim() || name === prevDirName(dir)) {
                    const parts = d.replace(/[\\/]+$/, "").split(/[\\/]/);
                    setName(parts[parts.length - 1] || "");
                  }
                }}
                placeholder={t("project.directoryPlaceholder")}
              />
              <button className="modal__btn--secondary" onClick={handlePickDir}>
                ...
              </button>
            </div>
          </label>
        ) : (
          <label className="modal__label">
            {t("project.parentDirectory")}
            <div className="modal__dir-row">
              <input
                className="modal__input"
                value={parentDir}
                onChange={(e) => setParentDir(e.target.value)}
                placeholder={t("project.parentDirPlaceholder")}
              />
              <button className="modal__btn--secondary" onClick={handlePickDir}>
                ...
              </button>
            </div>
            {parentDir && name.trim() && (
              <span className="modal__hint">
                → {parentDir.replace(/[\\/]+$/, "")}{parentDir.includes("\\") ? "\\" : "/"}{name.trim()}
              </span>
            )}
          </label>
        )}
        <div className="modal__actions">
          <button className="modal__btn--secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            className="modal__btn--primary"
            onClick={handleSubmit}
            disabled={!isValid}
          >
            {mode === "open" ? t("common.open") : t("common.create")}
          </button>
        </div>
        </FocusTrap>
      </div>
    </div>
  );
}
