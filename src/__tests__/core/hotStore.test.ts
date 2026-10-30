import { describe, expect, it, vi } from "vitest";
import type { StateCreator } from "zustand";
import { createHotStore, type StoreHotContext } from "../../core/hotStore";

interface State { loaded: boolean; value: number; increment: () => void }
const initial = (step: number): StateCreator<State> => (set) => ({ loaded: false, value: 0, increment: () => set(s => ({ value: s.value + step })) });
function context(data: Record<string, unknown> = {}) {
  const dispose = vi.fn();
  const hot: StoreHotContext = { data, dispose };
  return { hot, dispose };
}

describe("development hot store", () => {
  it("saves the store and disposes listeners through one Vite disposal callback", () => {
    const first = context();
    const releaseListener = vi.fn();
    const store = createHotStore(initial(1), first.hot, releaseListener);
    const saved: Record<string, unknown> = {};
    expect(first.dispose).toHaveBeenCalledOnce();
    first.dispose.mock.calls[0][0](saved);
    expect(saved.orbitStore).toBe(store);
    expect(releaseListener).toHaveBeenCalledWith(saved);
  });
  it("preserves the live store and subscribers while replacing action implementations", () => {
    const first = context();
    const store = createHotStore(initial(1), first.hot);
    store.setState({ loaded: true, value: 7 });
    const subscriber = vi.fn(); store.subscribe(subscriber);
    expect(first.dispose).toHaveBeenCalledOnce();
    const saved = {}; first.dispose.mock.calls[0][0](saved);
    const replacement = createHotStore(initial(10), context(saved).hot);
    expect(replacement).toBe(store);
    expect(replacement.getState().loaded).toBe(true);
    expect(replacement.getState().value).toBe(7);
    subscriber.mockClear();
    replacement.getState().increment();
    expect(store.getState().value).toBe(17);
    expect(subscriber).toHaveBeenCalledOnce();
  });
});
