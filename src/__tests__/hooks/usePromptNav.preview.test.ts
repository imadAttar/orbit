import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import { usePromptNav } from "../../features/terminal/hooks/usePromptNav";

vi.hoisted(() => {
  // No renderer is opened: xterm only probes canvas support on module import.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(cleanup);
const write = (term: Terminal, text: string) => new Promise<void>((resolve) => term.write(text, resolve));

describe("prompt navigation on a real unopened xterm buffer", () => {
  it("revalidates redraws, resize, alternate/reset buffers and instance ownership", async () => {
    const first = new Terminal({ cols: 40, rows: 5, allowProposedApi: true });
    const second = new Terminal({ cols: 40, rows: 5, allowProposedApi: true });
    const ref = { current: first };
    const view = renderHook(({ enabled }) => usePromptNav(ref, enabled), { initialProps: { enabled: true } });
    await act(async () => { await write(first, "❯ before"); });
    await waitFor(() => expect(view.result.current.previews[0]?.excerpt).toBe("before"));
    const stale = view.result.current.previews[0].id;
    const scroll = vi.spyOn(first, "scrollToLine");
    await act(async () => { await write(first, "\r\u001b[2K❯ after"); });
    act(() => view.result.current.jumpToPreview(stale));
    expect(scroll).not.toHaveBeenCalled();
    await waitFor(() => expect(view.result.current.previews[0]?.excerpt).toBe("after"));
    act(() => first.resize(10, 5));
    await waitFor(() => expect(view.result.current.previews[0]?.excerpt).toBe("after"));
    await act(async () => { await write(first, "\u001b[?1049h❯ not normal"); });
    await waitFor(() => expect(view.result.current.previews).toEqual([]));
    act(() => view.result.current.jumpRef.current("next"));
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => { await write(first, "\u001b[?1049l\u001bc"); });
    await waitFor(() => expect(view.result.current.previews).toEqual([]));
    await act(async () => { await write(first, "❯ final"); });
    await waitFor(() => expect(first.markers).toHaveLength(1));
    ref.current = second;
    view.rerender({ enabled: true });
    expect(first.markers).toHaveLength(0);
    await act(async () => { await write(second, "❯ replacement"); });
    await waitFor(() => expect(view.result.current.previews[0]?.excerpt).toBe("replacement"));
    view.rerender({ enabled: false });
    expect(second.markers).toHaveLength(0);
    expect(view.result.current.previews).toEqual([]);
    view.unmount(); first.dispose(); second.dispose();
  });
  it("refreshes same-length edits, scrolls only, rejects stale anchors and disposes on replacement", async () => {
    const term = new Terminal({ cols: 40, rows: 5, scrollback: 3, allowProposedApi: true });
    const ref = { current: term };
    const view = renderHook(() => usePromptNav(ref));
    await act(async () => { await write(term, "❯ first\r\nanswer\r\n❯ "); });
    await waitFor(() => expect(view.result.current.previews).toHaveLength(1));
    const old = view.result.current.previews[0];
    const scroll = vi.spyOn(term, "scrollToLine");
    const input = vi.fn();
    term.onData(input);
    act(() => view.result.current.jumpToPreview(old.id));
    expect(scroll).toHaveBeenLastCalledWith(0);
    expect(input).not.toHaveBeenCalled();
    await act(async () => { await write(term, "second"); });
    await waitFor(() => expect(view.result.current.previews).toHaveLength(2));
    await act(async () => { await write(term, "\r\n".repeat(20)); });
    // Even before a scheduled rescan, a trimmed marker may not jump elsewhere.
    scroll.mockClear();
    act(() => view.result.current.jumpToPreview(old.id));
    expect(scroll).not.toHaveBeenCalled();
    await waitFor(() => expect(view.result.current.previews).toHaveLength(0));
    await act(async () => { await write(term, "❯ replacement"); });
    await waitFor(() => expect(view.result.current.previews).toHaveLength(1));
    view.unmount();
    expect(term.markers).toHaveLength(0);
    term.dispose();
  });
});
