import { useMemo } from "react";
import { useStore } from "../core/store";
import type { Bookmark } from "../core/types";

const EMPTY_BOOKMARKS: Bookmark[] = [];

/** Shared bookmark selector + filtering logic used by Sidebar and CommandPalette */
export function useBookmarkFilter(query = "") {
  const bookmarks = useStore(
    (s) => s.projects.find((p) => p.id === s.activePid)?.bookmarks ?? EMPTY_BOOKMARKS,
  );
  const scores = useStore((s) => s.bookmarkScores);

  const filtered = useMemo(() => {
    if (!query) return bookmarks;
    const q = query.toLowerCase();
    return bookmarks.filter(
      (b) => b.name.toLowerCase().includes(q) || b.prompt.toLowerCase().includes(q),
    );
  }, [bookmarks, query]);

  const maxScore = useMemo(
    () => Math.max(...bookmarks.map((b) => scores[b.prompt] ?? 0), 1),
    [bookmarks, scores],
  );

  return { bookmarks, filtered, scores, maxScore };
}
