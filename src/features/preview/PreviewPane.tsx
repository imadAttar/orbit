import { useRef } from "react";
import { useT } from "../../i18n/i18n";
import { usePreviewStore } from "./previewStore";
import { EMPTY_PREVIEW } from "./previewModel";
import PreviewIcon from "./PreviewIcon";
import WebPreview from "./WebPreview";
import FilesPreview from "./FilesPreview";
import "./preview.css";

export default function PreviewPane({ projectId, projectDir, projectName }: { projectId: string; projectDir: string; projectName: string }) {
  const t = useT();
  const view = usePreviewStore(s => s.views[projectId] ?? EMPTY_PREVIEW);
  const width = usePreviewStore(s => s.width);
  const dispatch = usePreviewStore(s => s.dispatch);
  const setWidth = usePreviewStore(s => s.setWidth);
  const dragging = useRef<{ x: number; width: number } | null>(null);
  const send = (action: Parameters<typeof dispatch>[1]) => dispatch(projectId, action);
  return <aside className="preview-pane" aria-label={t("preview.title")} style={{ width }}>
    <div className="preview-resizer" role="separator" aria-label={t("preview.resize")} aria-orientation="vertical" aria-valuemin={340} aria-valuemax={900} aria-valuenow={width} tabIndex={0}
      onPointerDown={e => { dragging.current = { x: e.clientX, width }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (dragging.current) setWidth(dragging.current.width + dragging.current.x - e.clientX); }}
      onPointerUp={e => { dragging.current = null; e.currentTarget.releasePointerCapture(e.pointerId); }}
      onPointerCancel={() => { dragging.current = null; }}
      onKeyDown={e => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); setWidth(width + (e.key === "ArrowLeft" ? 24 : -24)); } }} />
    <header className="preview-pane__header"><span><PreviewIcon kind="panel" /><strong>{t("preview.title")}</strong></span><span className="preview-pane__project" title={projectDir}>{projectName}</span><button className="preview-button" title={t("preview.close")} aria-label={t("preview.close")} onClick={() => send({ type: "close" })}><PreviewIcon kind="close" /></button></header>
    <nav className="preview-tabs" aria-label={t("preview.title")}><button aria-pressed={view.mode === "web"} onClick={() => send({ type: "mode", mode: "web" })}><PreviewIcon kind="web" />{t("preview.web")}</button><button aria-pressed={view.mode === "files"} onClick={() => send({ type: "mode", mode: "files" })}><PreviewIcon kind="file" />{t("preview.files")}</button></nav>
    {view.mode === "web" ? <WebPreview view={view} dispatch={send} /> : <FilesPreview projectDir={projectDir} path={view.path} dispatch={send} />}
  </aside>;
}
