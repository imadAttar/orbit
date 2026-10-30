import { normalizePreviewUrl } from "./previewModel";
export interface TerminalPreviewLink { startIndex: number; length: number; target: { type: "url"; url: string } | { type: "file"; path: string }; line?: number }
/** Only click affordances; the terminal's original bytes and rendering are unchanged. */
export function terminalPreviewLinks(text: string): TerminalPreviewLink[] {
  const links: TerminalPreviewLink[] = [];
  const urls: { start: number; end: number }[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    const start = match.index;
    urls.push({ start, end: start + match[0].length });
    let value = match[0].replace(/[.,;!]+$/, "");
    if (value.endsWith(")") && !value.includes("(")) value = value.slice(0, -1);
    try { links.push({ startIndex: start, length: value.length, target: { type: "url", url: normalizePreviewUrl(value) } }); } catch { /* Unsafe URLs are not actionable. */ }
  }
  const file = /(?:[A-Za-z]:\\|\/|\.\.?\/)?(?:[\p{L}\p{N}_.@-]+[\/\\])*[\p{L}\p{N}_.@-]+\.[a-zA-Z0-9]{1,12}(?::(\d+))?(?::\d+)?/gu;
  for (const match of text.matchAll(file)) {
    if (urls.some(url => match.index >= url.start && match.index < url.end)) continue;
    const path = match[0].replace(/:\d+(?::\d+)?$/, "");
    links.push({ startIndex: match.index, length: match[0].length, target: { type: "file", path }, ...(match[1] ? { line: Number(match[1]) } : {}) });
  }
  return links.sort((a, b) => a.startIndex - b.startIndex);
}
