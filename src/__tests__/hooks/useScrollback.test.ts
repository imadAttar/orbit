import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useEffect } from "react";
import type { Terminal } from "@xterm/xterm";
import type { SerializeAddon } from "@xterm/addon-serialize";
import { useScrollback } from "../../features/terminal/hooks/useScrollback";
import { scrollback } from "../../core/api";

vi.mock("../../core/api", () => ({ scrollback: { save: vi.fn() } }));
vi.mock("../../lib/logger", () => ({ logger: { warn: vi.fn() } }));

function instance(data: string) {
  return {
    term: {} as Terminal,
    addon: { serialize: vi.fn(() => data) } as unknown as SerializeAddon,
  };
}

function mount(spawned = true) {
  const old = instance("old history");
  const termRef = { current: old.term as Terminal | null };
  const serializeRef = { current: old.addon as SerializeAddon | null };
  const hook = renderHook(
    ({ sessionId, spawned }) => useScrollback(termRef, serializeRef, sessionId, spawned),
    { initialProps: { sessionId: "old-session", spawned } },
  );
  return { ...hook, old, termRef, serializeRef };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("saves the old instance under its own session when refs point to a new empty terminal", () => {
  const hook = mount();
  const next = instance("");
  hook.termRef.current = next.term;
  hook.serializeRef.current = next.addon;
  hook.rerender({ sessionId: "new-session", spawned: true });
  expect(scrollback.save).toHaveBeenCalledExactlyOnceWith("old-session", "old history");
  expect(next.addon.serialize).not.toHaveBeenCalled();
});

it("keeps the nonempty saved history if a disposed serializer returns empty on cleanup", () => {
  vi.useFakeTimers();
  const hook = mount();
  act(() => vi.advanceTimersByTime(30000));
  vi.mocked(hook.old.addon.serialize).mockReturnValue("");
  hook.unmount();
  expect(scrollback.save).toHaveBeenCalledExactlyOnceWith("old-session", "old history");
});

it("still saves the captured instance when both refs are cleared before unmount", () => {
  const hook = mount();
  hook.termRef.current = null;
  hook.serializeRef.current = null;
  hook.unmount();
  expect(scrollback.save).toHaveBeenCalledExactlyOnceWith("old-session", "old history");
});

it("saves the latest content on final unmount and disables the exposed callback", () => {
  const hook = mount();
  vi.mocked(hook.old.addon.serialize).mockReturnValue("last output");
  const saveRef = hook.result.current;
  hook.unmount();
  saveRef.current();
  expect(scrollback.save).toHaveBeenCalledExactlyOnceWith("old-session", "last output");
});

it("saves every 30 seconds from the captured instance even if refs change without a render", () => {
  vi.useFakeTimers();
  const hook = mount();
  const next = instance("new output");
  hook.termRef.current = next.term;
  hook.serializeRef.current = next.addon;
  act(() => vi.advanceTimersByTime(29999));
  expect(scrollback.save).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(scrollback.save).toHaveBeenLastCalledWith("old-session", "old history");
  act(() => vi.advanceTimersByTime(30000));
  expect(scrollback.save).toHaveBeenCalledTimes(2);
  expect(next.addon.serialize).not.toHaveBeenCalled();
  hook.unmount();
  vi.mocked(scrollback.save).mockClear();
  act(() => vi.advanceTimersByTime(60000));
  expect(scrollback.save).not.toHaveBeenCalled();
});

it("does not save through any trigger before spawned", () => {
  vi.useFakeTimers();
  const hook = mount(false);
  hook.result.current.current();
  act(() => vi.advanceTimersByTime(60000));
  window.dispatchEvent(new Event("beforeunload"));
  hook.unmount();
  expect(scrollback.save).not.toHaveBeenCalled();
  expect(hook.old.addon.serialize).not.toHaveBeenCalled();
});

it("saves on beforeunload and removes the listener on unmount", () => {
  const hook = mount();
  window.dispatchEvent(new Event("beforeunload"));
  expect(scrollback.save).toHaveBeenCalledExactlyOnceWith("old-session", "old history");
  hook.unmount();
  vi.mocked(scrollback.save).mockClear();
  window.dispatchEvent(new Event("beforeunload"));
  expect(scrollback.save).not.toHaveBeenCalled();
});

it("saves the old instance when spawned becomes false after refs have been replaced", () => {
  const hook = mount();
  const next = instance("");
  hook.termRef.current = next.term;
  hook.serializeRef.current = next.addon;
  hook.rerender({ sessionId: "old-session", spawned: false });
  hook.result.current.current();
  hook.unmount();
  expect(scrollback.save).toHaveBeenCalledExactlyOnceWith("old-session", "old history");
  expect(next.addon.serialize).not.toHaveBeenCalled();
});

it("preserves the last persisted snapshot when disposed serialization throws", () => {
  vi.useFakeTimers();
  const hook = mount();
  act(() => vi.advanceTimersByTime(30000));
  vi.mocked(hook.old.addon.serialize).mockImplementation(() => { throw new Error("disposed"); });
  hook.termRef.current = null;
  hook.serializeRef.current = null;
  expect(() => hook.unmount()).not.toThrow();
  expect(scrollback.save).toHaveBeenCalledExactlyOnceWith("old-session", "old history");
});

it("tolerates missing refs when a spawned effect starts", () => {
  vi.useFakeTimers();
  const termRef = { current: null };
  const serializeRef = { current: null };
  const hook = renderHook(() => useScrollback(termRef, serializeRef, "s", true));
  act(() => vi.advanceTimersByTime(30000));
  window.dispatchEvent(new Event("beforeunload"));
  hook.unmount();
  expect(scrollback.save).not.toHaveBeenCalled();
});

it("documents React ordering: owner-only restart disposes before scrollback cleanup; final unmount saves first", () => {
  const events: string[] = [];
  const termRef = { current: null as Terminal | null };
  const serializeRef = { current: null as SerializeAddon | null };
  const hook = renderHook(({ generation, spawned }) => {
    useScrollback(termRef, serializeRef, "s", spawned);
    useEffect(() => {
      const current = instance(`generation ${generation}`);
      vi.mocked(current.addon.serialize).mockImplementation(() => {
        events.push(`serialize ${generation}`);
        return `generation ${generation}`;
      });
      termRef.current = current.term;
      serializeRef.current = current.addon;
      events.push(`setup ${generation}`);
      return () => {
        events.push(`dispose ${generation}`);
        vi.mocked(current.addon.serialize).mockImplementation(() => {
          events.push(`serialize disposed ${generation}`);
          throw new Error("disposed");
        });
        termRef.current = null;
        serializeRef.current = null;
      };
    }, [generation]);
  }, { initialProps: { generation: 0, spawned: false } });
  hook.rerender({ generation: 0, spawned: true });
  hook.rerender({ generation: 1, spawned: true });
  expect(events).toEqual(["setup 0", "dispose 0", "setup 1"]);
  hook.rerender({ generation: 1, spawned: false });
  expect(events[events.length - 1]).toBe("serialize disposed 0");
  expect(scrollback.save).not.toHaveBeenCalled();
  hook.rerender({ generation: 1, spawned: true });
  hook.unmount();
  expect(events.slice(-2)).toEqual(["serialize 1", "dispose 1"]);
  expect(scrollback.save).toHaveBeenCalledExactlyOnceWith("s", "generation 1");
});
