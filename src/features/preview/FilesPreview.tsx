import { useEffect, useState } from "react";
import { preview, type PreviewEntry, type PreviewFile } from "../../core/api";
import { useT } from "../../i18n/i18n";
import type { PreviewAction } from "./previewModel";
import PreviewIcon from "./PreviewIcon";
import FileContent from "./FileContent";

export default function FilesPreview({ projectDir, path, dispatch }: { projectDir: string; path: string | null; dispatch: (action: PreviewAction) => void }) {
  const t = useT();
  const [directory, setDirectory] = useState("");
  const [entries, setEntries] = useState<PreviewEntry[]>([]);
  const [browse, setBrowse] = useState(!path);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState("");
  const [fileError, setFileError] = useState("");
  const [record, setRecord] = useState<{ request: string; file: PreviewFile } | null>(null);
  const [source, setSource] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [input, setInput] = useState(path ?? "");
  useEffect(() => { setInput(path ?? ""); setSource(false); if (path) setBrowse(false); }, [path]);
  useEffect(() => {
    if (!browse) return;
    let cancelled = false;
    setLoadingList(true); setListError("");
    preview.listFiles(projectDir, directory).then(data => { if (!cancelled) setEntries(data); })
      .catch(() => { if (!cancelled) { setEntries([]); setListError(t("preview.listFailed")); } })
      .finally(() => { if (!cancelled) setLoadingList(false); });
    return () => { cancelled = true; };
  }, [projectDir, directory, browse, refresh, t]);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        if (!document.hidden) {
          const file = await preview.readFile(projectDir, path);
          if (!cancelled) {
            setRecord(old => old?.request === path && old.file.modifiedAt === file.modifiedAt && old.file.content === file.content ? old : { request: path, file });
            setFileError("");
          }
        }
      } catch { if (!cancelled) setFileError(t("preview.readFailed")); }
      finally { if (!cancelled) timer = setTimeout(() => { void read(); }, 2000); }
    };
    void read();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [projectDir, path, refresh, t]);
  const file = record?.request === path ? record.file : null;
  const select = (value: string) => { if (value.trim()) dispatch({ type: "file", path: value.trim() }); };
  const pick = async () => { try { const selected = await preview.pickFile(); if (selected) select(selected); } catch { setListError(t("preview.openFailed")); } };
  return <div className="files-preview">
    <form className="preview-address" onSubmit={e => { e.preventDefault(); select(input); }}>
      <button type="button" className="preview-button" aria-label={t("preview.browse")} title={t("preview.browse")} aria-pressed={browse} onClick={() => setBrowse(v => !v)}><PreviewIcon kind="folder" /></button>
      <input aria-label={t("preview.path")} placeholder="README.md" value={input} onChange={e => setInput(e.target.value)} autoComplete="off" spellCheck={false} />
      <button className="preview-button" type="submit" title={t("preview.openFile")} aria-label={t("preview.openFile")}><PreviewIcon kind="forward" /></button>
      <button type="button" className="preview-button" aria-label={t("preview.reload")} title={t("preview.reload")} onClick={() => setRefresh(n => n + 1)}><PreviewIcon kind="reload" /></button>
    </form>
    {browse ? <div className="preview-explorer">
      <div className="preview-explorer__heading"><strong>{directory || t("preview.projectFiles")}</strong><button className="preview-button" title={t("preview.up")} aria-label={t("preview.up")} disabled={!directory} onClick={() => setDirectory(directory.split("/").slice(0, -1).join("/"))}><PreviewIcon kind="up" /></button></div>
      {loadingList && <p className="preview-subtle" role="status">{t("preview.loading")}</p>}
      {listError && <p className="preview-error" role="alert">{listError}</p>}
      {!loadingList && !listError && !entries.length && <p className="preview-subtle">{t("preview.emptyDir")}</p>}
      <div className="preview-file-list">{entries.map(entry => <button key={entry.path} title={entry.path} onClick={() => entry.kind === "directory" ? setDirectory(entry.path) : select(entry.path)}><PreviewIcon kind={entry.kind === "directory" ? "folder" : "file"} /><span>{entry.name}</span>{entry.kind === "directory" && <PreviewIcon kind="forward" />}</button>)}</div>
      {entries.length >= 300 && <p className="preview-subtle">{t("preview.listLimit")}</p>}
      <button className="preview-text-button preview-picker" onClick={() => { void pick(); }}><PreviewIcon kind="external" />{t("preview.pickFile")}</button>
    </div> : <>
      {fileError && <p className="preview-error" role="alert">{fileError}</p>}
      {!path ? <div className="preview-empty"><PreviewIcon kind="file" /><h2>{t("preview.selectFile")}</h2><button className="preview-text-button" onClick={() => setBrowse(true)}>{t("preview.browse")}</button></div> : !file && !fileError ? <p className="preview-subtle" role="status">{t("preview.loading")}</p> : null}
      {file && <><div className="preview-file-meta"><span title={file.path}>{file.name}</span>{file.kind === "markdown" && <div className="preview-file-modes"><button aria-pressed={!source} onClick={() => setSource(false)}>{t("preview.rendered")}</button><button aria-pressed={source} onClick={() => setSource(true)}>{t("preview.source")}</button></div>}</div><div className="preview-document"><FileContent key={path} file={file} path={path!} source={source} dispatch={dispatch} /></div></>}
    </>}
    <p className="preview-footnote"><span className="preview-live-dot" />{path ? t("preview.live") : t("preview.readonly")}</p>
  </div>;
}
