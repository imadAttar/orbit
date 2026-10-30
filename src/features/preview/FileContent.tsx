import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PreviewFile } from "../../core/api";
import { useT } from "../../i18n/i18n";
import { resolvePreviewLink, type PreviewAction } from "./previewModel";

export default function FileContent({ file, source, path, dispatch }: { file: PreviewFile; source: boolean; path: string; dispatch: (action: PreviewAction) => void }) {
  const t = useT();
  const follow = (href: string) => { const action = resolvePreviewLink(href, path); if (action) dispatch(action); };
  if (file.kind === "image" && ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"].includes(file.mime)) {
    return <div className="preview-image"><img src={`data:${file.mime};base64,${file.content}`} alt={file.name} /></div>;
  }
  if (file.kind === "markdown" && !source) return <article className="preview-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ href, children }) => <a href={href || undefined} onClick={e => { e.preventDefault(); if (href) follow(href); }}>{children}</a>,
    // Images are explicit links: no tracking pixels or remote fetches on Markdown load.
    img: ({ src, alt }) => <button className="preview-text-button" onClick={() => { if (typeof src === "string") follow(src); }}>{t("preview.image")} · {alt || (typeof src === "string" ? src : "")}</button>,
  }}>{file.content}</Markdown></article>;
  return <pre className="preview-source" tabIndex={0}><code>{file.content}</code></pre>;
}
