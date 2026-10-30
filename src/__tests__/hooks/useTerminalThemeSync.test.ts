import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Terminal } from "@xterm/xterm";
vi.mock("../../core/store", () => ({ useStore: vi.fn() }));
import { THEMES, applyChrome } from "../../lib/themes";
import { useTerminalThemeSync } from "../../hooks/useThemeSync";

describe("terminal palette preview", () => {
  it("updates mounted hidden and visible terminals on preview and cancel, without touching their buffers", () => {
    const visible = { options: { theme: THEMES.orbit.terminal }, write: vi.fn(), reset: vi.fn() };
    const hidden = { options: { theme: THEMES.orbit.terminal }, write: vi.fn(), reset: vi.fn() };
    const first = renderHook(() => useTerminalThemeSync({ current: visible as unknown as Terminal }));
    const second = renderHook(() => useTerminalThemeSync({ current: hidden as unknown as Terminal }));
    for (const theme of [THEMES["orbit-light"], THEMES.dracula, THEMES.orbit]) {
      applyChrome(theme);
      expect(visible.options.theme).toEqual(theme.terminal);
      expect(hidden.options.theme).toEqual(theme.terminal);
    }
    expect(visible.write).not.toHaveBeenCalled();
    expect(hidden.reset).not.toHaveBeenCalled();
    first.unmount(); second.unmount();
    applyChrome(THEMES.nord);
    expect(hidden.options.theme).toEqual(THEMES.orbit.terminal);
  });
});
