import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ settings: { fontSize: 14 }, setFontSize: vi.fn() }));
vi.mock("../../core/store", () => ({ useStore: (select: (s: typeof state) => unknown) => select(state) }));
vi.mock("../../i18n/i18n", () => ({ useT: () => (key: string) => key }));
import TerminalToolbar from "../../layout/TerminalToolbar";
beforeEach(() => { vi.clearAllMocks(); state.settings.fontSize = 14; });
afterEach(cleanup);

describe("native terminal readability toolbar", () => {
  it("opens only local terminal search without sending input to Claude", () => {
    const onSearch = vi.fn();
    render(<TerminalToolbar onSearch={onSearch} searchOpen={false} />);
    const button = screen.getByRole("button", { name: "shortcuts.searchTerminal" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(onSearch).toHaveBeenCalledOnce();
    expect(state.setFontSize).not.toHaveBeenCalled();
  });
  it("changes only the existing font preference within supported limits", () => {
    render(<TerminalToolbar onSearch={vi.fn()} searchOpen />);
    expect(screen.getByText("14px")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "shortcuts.zoomIn" }));
    expect(state.setFontSize).toHaveBeenCalledWith(15);
    fireEvent.click(screen.getByRole("button", { name: "shortcuts.zoomOut" }));
    expect(state.setFontSize).toHaveBeenCalledWith(13);
    expect(screen.getByRole("button", { name: "shortcuts.searchTerminal" }).getAttribute("aria-pressed")).toBe("true");
  });
  it.each([[8, "shortcuts.zoomOut"], [20, "shortcuts.zoomIn"]] as const)("disables the limit action at %spx", (size, name) => {
    state.settings.fontSize = size;
    render(<TerminalToolbar onSearch={vi.fn()} searchOpen={false} />);
    const button = screen.getByRole("button", { name }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(state.setFontSize).not.toHaveBeenCalled();
  });
});
