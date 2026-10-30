import { create, type StateCreator, type StoreApi, type UseBoundStore } from "zustand";

export interface StoreHotContext {
  data: Record<string, unknown>;
  dispose: (callback: (data: Record<string, unknown>) => void) => void;
}

/** Dev-only continuity: keep subscribers/data, but bind fresh actions to the live API. */
export function createHotStore<T extends object>(initializer: StateCreator<T>, hot?: StoreHotContext,
  dispose?: (data: Record<string, unknown>) => void) {
  const previous = hot?.data.orbitStore as UseBoundStore<StoreApi<T>> | undefined;
  const store = previous ?? create<T>(initializer);
  if (previous) {
    const next = initializer(store.setState, store.getState, store);
    const current = store.getState();
    const updates = Object.fromEntries(Object.entries(next).filter(([key, value]) =>
      typeof value === "function" || !(key in current)));
    store.setState(updates as Partial<T>);
  }
  // Vite keeps one disposal callback per module: combine state and listener cleanup.
  hot?.dispose(data => { data.orbitStore = store; dispose?.(data); });
  return store;
}
