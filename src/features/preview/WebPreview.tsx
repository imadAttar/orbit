import { useEffect, useState } from "react";
import { preview } from "../../core/api";
import { useT } from "../../i18n/i18n";
import type { PreviewAction, PreviewView } from "./previewModel";
import PreviewIcon from "./PreviewIcon";

export default function WebPreview({ view, dispatch }: { view: PreviewView; dispatch: (action: PreviewAction) => void }) {
  const t = useT();
  const url = view.history[view.historyIndex] ?? "";
  const [address, setAddress] = useState(url);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => { setAddress(url); setError(""); }, [url]);
  const open = (value: string) => { try { dispatch({ type: "url", url: value }); setError(""); } catch { setError(t("preview.invalidUrl")); } };
  return <div className="web-preview">
    <form className="preview-address" onSubmit={e => { e.preventDefault(); open(address); }}>
      <button type="button" className="preview-button" aria-label={t("preview.back")} title={t("preview.back")} disabled={view.historyIndex <= 0} onClick={() => dispatch({ type: "back" })}><PreviewIcon kind="back" /></button>
      <button type="button" className="preview-button" aria-label={t("preview.forward")} title={t("preview.forward")} disabled={view.historyIndex + 1 >= view.history.length} onClick={() => dispatch({ type: "forward" })}><PreviewIcon kind="forward" /></button>
      <button type="button" className="preview-button" aria-label={t("preview.reload")} title={t("preview.reload")} disabled={!url} onClick={() => setRevision(n => n + 1)}><PreviewIcon kind="reload" /></button>
      <input aria-label={t("preview.address")} value={address} onChange={e => setAddress(e.target.value)} placeholder="localhost:3000" spellCheck={false} autoCapitalize="off" autoComplete="off" />
      <button className="preview-button preview-button--go" type="submit" aria-label={t("preview.go")} title={t("preview.go")}><PreviewIcon kind="forward" /></button>
      <button type="button" className="preview-button" aria-label={t("preview.external")} title={t("preview.external")} disabled={!url} onClick={() => { void preview.openExternal(url).catch(() => setError(t("preview.openFailed"))); }}><PreviewIcon kind="external" /></button>
    </form>
    {error && <p className="preview-error" role="alert">{error}</p>}
    {url ? <iframe key={`${url}-${revision}`} className="preview-browser" src={url} title={t("preview.web")} sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer" /> :
      <div className="preview-empty"><PreviewIcon kind="web" /><h2>{t("preview.emptyWeb")}</h2><p>{t("preview.webStart")}</p><button className="preview-text-button" onClick={() => open("http://localhost:3000")}>localhost:3000 <PreviewIcon kind="forward" /></button></div>}
    <p className="preview-footnote">{t("preview.webHint")}</p>
  </div>;
}
