import { describe, it, expect } from "vitest";

// Platform detection runs at module load from navigator.userAgent.
// We test the exported values which depend on the jsdom UA.

describe("platform", () => {
  it("exports isMac, isWindows, isLinux booleans", async () => {
    const { isMac, isWindows, isLinux } = await import("../../lib/platform");
    expect(typeof isMac).toBe("boolean");
    expect(typeof isWindows).toBe("boolean");
    expect(typeof isLinux).toBe("boolean");
    // Exactly one should be true (mutually exclusive by construction)
    // In jsdom, UA usually doesn't contain "mac" or "windows", so isLinux = true
    const trueCount = [isMac, isWindows, isLinux].filter(Boolean).length;
    expect(trueCount).toBe(1);
  });

  it("exports modLabel as 'Cmd' or 'Ctrl'", async () => {
    const { modLabel } = await import("../../lib/platform");
    expect(["Cmd", "Ctrl"]).toContain(modLabel);
  });

  it("exports modSymbol", async () => {
    const { modSymbol } = await import("../../lib/platform");
    expect(typeof modSymbol).toBe("string");
    expect(modSymbol.length).toBeGreaterThan(0);
  });

  it("exports terminalOptions as non-empty array", async () => {
    const { terminalOptions } = await import("../../lib/platform");
    expect(Array.isArray(terminalOptions)).toBe(true);
    expect(terminalOptions.length).toBeGreaterThan(0);
    for (const opt of terminalOptions) {
      expect(opt).toHaveProperty("value");
      expect(opt).toHaveProperty("label");
    }
  });

  it("exports defaultTerminal matching first option", async () => {
    const { defaultTerminal, terminalOptions } = await import("../../lib/platform");
    expect(defaultTerminal).toBe(terminalOptions[0].value);
  });
});
