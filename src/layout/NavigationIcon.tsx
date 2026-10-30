type Kind = "plus" | "attention" | "search" | "folder" | "pin" | "terminal" | "archive" | "settings" | "chevron" | "more" | "sessions";
const paths: Record<Kind, string> = {
  plus: "M12 5v14M5 12h14",
  attention: "M12 3 2 20h20L12 3ZM12 9v4m0 3v.1",
  search: "m20 20-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
  folder: "M3 6h6l2 2h10v12H3V6Z",
  pin: "m8 3 8 0-1 6 4 4v2H5v-2l4-4-1-6ZM12 15v6",
  terminal: "m5 7 5 5-5 5m8 0h6",
  archive: "M3 4h18v4H3V4Zm2 4v12h14V8m-10 4h6",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  chevron: "m9 5 7 7-7 7",
  more: "M5 12h.1m6.9 0h.1m6.9 0h.1",
  sessions: "M4 4h16v13H9l-5 4V4Z",
};
export default function NavigationIcon({ kind }: { kind: Kind }) {
  return <svg className="navigation-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}
