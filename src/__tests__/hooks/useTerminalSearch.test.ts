import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import type { SearchAddon } from "@xterm/addon-search";
import { useTerminalSearch } from "../../features/terminal/hooks/useTerminalSearch";
afterEach(cleanup);
function refs() {
  const search = { findNext: vi.fn(), findPrevious: vi.fn(), clearDecorations: vi.fn() };
  const terminal = { focus: vi.fn() };
  return { search, terminal, searchRef: { current: search as unknown as SearchAddon }, termRef: { current: terminal as unknown as Terminal } };
}

describe("terminal-local search without changing Claude output", () => {
  it("never moves keyboard focus into a hidden cached terminal", () => {
    const r = refs();
    const view = renderHook(({ active, open }) => useTerminalSearch(r.searchRef, r.termRef, open, "", active), { initialProps: { active: false, open: false } });
    expect(r.terminal.focus).not.toHaveBeenCalled();
    view.rerender({ active: false, open: true });
    view.rerender({ active: false, open: false });
    expect(r.terminal.focus).not.toHaveBeenCalled();
  });
  it("restores focus to the visible terminal when closing its search", () => {
    const r = refs();
    const view = renderHook(({ open }) => useTerminalSearch(r.searchRef, r.termRef, open, "needle", true), { initialProps: { open: true } });
    view.rerender({ open: false });
    expect(r.terminal.focus).toHaveBeenCalledOnce();
    expect(r.search.clearDecorations).toHaveBeenCalled();
  });
  it("highlights matches while typing and clears stale highlights on an empty query", () => {
    const r = refs();
    const view = renderHook(({ query }) => useTerminalSearch(r.searchRef, r.termRef, true, query, true), { initialProps: { query: "needle" } });
    expect(r.search.findNext).toHaveBeenCalledWith("needle", { incremental: true });
    view.rerender({ query: "" });
    expect(r.search.clearDecorations).toHaveBeenCalled();
  });
  it("does not search the scrollback of background sessions", () => {
    const r = refs();
    renderHook(() => useTerminalSearch(r.searchRef, r.termRef, true, "needle", false));
    expect(r.search.findNext).not.toHaveBeenCalled();
  });
});
