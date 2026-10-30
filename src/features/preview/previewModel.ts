export interface PreviewView {
  open: boolean;
  mode: "web" | "files";
  history: string[];
  historyIndex: number;
  path: string | null;
}
export const EMPTY_PREVIEW: PreviewView = { open: false, mode: "web", history: [], historyIndex: -1, path: null };
export type PreviewAction = { type: "url"; url: string } | { type: "file"; path: string } |
  { type: "mode"; mode: "web" | "files" } | { type: "toggle" } | { type: "close" } | { type: "back" } | { type: "forward" };
export function resolvePreviewLink(href: string, path: string): PreviewAction | null {
  if (!href || href.startsWith("#")) return null;
  try {
    if (/^https?:\/\//i.test(href)) return { type: "url", url: normalizePreviewUrl(href) };
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return null;
    const value = decodeURIComponent(href.split(/[?#]/)[0]);
    if (!value || /[\u0000-\u001f\u007f]/.test(value)) return null;
    if (value.startsWith("/")) return { type: "file", path: value };
    const parts = path.replace(/\\/g, "/").split("/").slice(0, -1);
    const absolute = path.startsWith("/");
    for (const part of value.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") { if (!parts.length || (absolute && parts.length === 1 && !parts[0])) return null; parts.pop(); }
      else parts.push(part);
    }
    return { type: "file", path: parts.join("/") };
  } catch { return null; }
}
export function normalizePreviewUrl(value: string): string {
  if (!value || /[\u0000-\u0020\u007f\\]/.test(value)) throw new Error("Adresse web invalide");
  const local = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(?::\d+)?(?:\/|$)/i.test(value);
  const explicit = /^https?:\/\//i.test(value);
  if (!explicit && !local && /^[a-z][a-z0-9+.-]*:/i.test(value)) throw new Error("Seules les adresses HTTP et HTTPS sont autorisées");
  const url = new URL(explicit ? value : `${local ? "http" : "https"}://${value}`);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      ["tauri.localhost", "asset.localhost"].includes(host) ||
      (url.port === "1420" && (host === "localhost" || host.endsWith(".localhost") || /^127\./.test(host) || host === "[::1]" || host === "0.0.0.0"))) {
    throw new Error("Cette adresse ne peut pas être ouverte dans l’aperçu");
  }
  return url.href;
}
export function previewReducer(view: PreviewView, action: PreviewAction): PreviewView {
  switch (action.type) {
    case "url": {
      const url = normalizePreviewUrl(action.url);
      if (view.history[view.historyIndex] === url) return { ...view, mode: "web", open: true };
      const history = [...view.history.slice(0, view.historyIndex + 1), url].slice(-32);
      return { ...view, mode: "web", open: true, history, historyIndex: history.length - 1 };
    }
    case "file": return { ...view, mode: "files", open: true, path: action.path };
    case "mode": return { ...view, mode: action.mode };
    case "toggle": return { ...view, open: !view.open };
    case "close": return { ...view, open: false };
    case "back": return view.historyIndex > 0 ? { ...view, historyIndex: view.historyIndex - 1 } : view;
    case "forward": return view.historyIndex + 1 < view.history.length ? { ...view, historyIndex: view.historyIndex + 1 } : view;
  }
}
