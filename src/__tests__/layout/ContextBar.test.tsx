import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("../../core/api", () => ({ listen: hooks.listen }));
vi.mock("../../lib/platform", () => ({ isWindows: false }));
vi.mock("../../i18n/i18n", () => ({ useT: () => (key: string) => key }));
import ContextBar from "../../layout/ContextBar";

let listener: (raw: string) => void;
const unlisten = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  hooks.listen.mockImplementation((_name, callback) => { listener = callback; return Promise.resolve(unlisten); });
});
afterEach(cleanup);
async function emit(payload: object) { await act(async () => listener(JSON.stringify(payload))); }
// Cast until the new explicitly session-scoped component contract is implemented.
const ScopedContextBar = ContextBar as React.ComponentType<{ conversationId?: string }>;

describe("session-scoped context bar", () => {
  it("ignores legacy global metrics and other conversations", async () => {
    render(<ScopedContextBar conversationId="c1" />);
    await emit({ context_pct: 45, model: "Global model" });
    expect(screen.queryByText("45%")).toBeNull();
    await emit({ session_id: "c2", context_pct: 60 });
    expect(screen.queryByText("60%")).toBeNull();
    await emit({ session_id: "c1", context_pct: 30, model: "Observed model" });
    expect(screen.getByText("30%")).toBeTruthy();
    expect(screen.getByText("Observed model")).toBeTruthy();
  });
  it("never displays metrics in a plain terminal or unidentified conversation", async () => {
    render(<ScopedContextBar />);
    expect(hooks.listen).not.toHaveBeenCalled();
    expect(screen.queryByText("contextbar.label")).toBeNull();
  });
  it("hides the previous conversation's metrics immediately on navigation", async () => {
    const view = render(<ScopedContextBar conversationId="c1" />);
    await emit({ session_id: "c1", context_pct: 35 });
    expect(screen.getByText("35%")).toBeTruthy();
    view.rerender(<ScopedContextBar conversationId="c2" />);
    expect(screen.queryByText("35%")).toBeNull();
    await emit({ session_id: "c2", context_pct: 15 });
    expect(screen.getByText("15%")).toBeTruthy();
  });
  it("unsubscribes even when event registration resolves after unmount", async () => {
    let resolve!: (unlisten: () => void) => void;
    hooks.listen.mockReturnValue(new Promise<( ) => void>(r => { resolve = r; }));
    const view = render(<ScopedContextBar conversationId="c1" />);
    view.unmount();
    await act(async () => resolve(unlisten));
    expect(unlisten).toHaveBeenCalledOnce();
  });
  it("ignores malformed metrics rather than rendering them", async () => {
    render(<ScopedContextBar conversationId="c1" />);
    for (const context_pct of [-1, 101, "50"]) await emit({ session_id: "c1", context_pct });
    await emit({ session_id: "c1", context_pct: 50, model: { unexpected: true } });
    expect(screen.queryByText("contextbar.label")).toBeNull();
  });
});
