import { useRef, useEffect } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { SearchAddon } from "@xterm/addon-search";

/**
 * Terminal search hook — manages search state, focus, and decorations.
 */
export function useTerminalSearch(
  searchRef: React.RefObject<SearchAddon | null>,
  termRef: React.RefObject<XTerm | null>,
  searchOpen: boolean,
  searchQuery: string,
  active = true,
) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!active) return;
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
      searchInputRef.current.select();
    }
    if (!searchOpen) {
      searchRef.current?.clearDecorations();
      termRef.current?.focus();
    }
  }, [searchOpen, active, searchRef, termRef]);

  useEffect(() => {
    if (!active || !searchOpen) return;
    if (searchQuery) searchRef.current?.findNext(searchQuery, { incremental: true });
    else searchRef.current?.clearDecorations();
  }, [searchQuery, searchOpen, active, searchRef]);

  const doSearchNext = () => {
    if (searchQuery && searchRef.current) searchRef.current.findNext(searchQuery);
  };

  const doSearchPrev = () => {
    if (searchQuery && searchRef.current) searchRef.current.findPrevious(searchQuery);
  };

  return { searchInputRef, doSearchNext, doSearchPrev };
}
