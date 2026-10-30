type Kind = "panel" | "web" | "file" | "folder" | "back" | "forward" | "reload" | "external" | "close" | "up";
const paths: Record<Kind, string> = {
  panel: "M3 4h18v16H3V4Zm11 0v16", web: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c4 5 4 13 0 18-4-5-4-13 0-18Z",
  file: "M6 3h8l4 4v14H6V3Zm8 0v5h4M9 12h6m-6 4h6", folder: "M3 6h6l2 2h10v12H3V6Z",
  back: "m14 5-7 7 7 7", forward: "m10 5 7 7-7 7", reload: "M20 8a8 8 0 1 0 0 8M20 3v6h-6",
  external: "M14 3h7v7m-1-6-10 10M10 3H3v18h18v-7", close: "m6 6 12 12M18 6 6 18", up: "m5 14 7-7 7 7",
};
export default function PreviewIcon({ kind }: { kind: Kind }) {
  return <svg className="preview-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}
