import { describe, expect, it } from "vitest";
import { scanPromptPreviews } from "../../features/terminal/terminalPromptAnchors";

function buffer(lines: Array<string | [string, boolean]>) {
  return { type: "normal" as const, length: lines.length, getLine: (i: number) => {
    const value = lines[i];
    if (value === undefined) return undefined;
    return { isWrapped: Array.isArray(value) && value[1], translateToString: () => Array.isArray(value) ? value[0] : value };
  } };
}

describe("rendered terminal prompt previews (not conversation records)", () => {
  it("bounds retained entries, scanned rows and excerpt allocation", () => {
    let reads = 0;
    const large = { type: "normal" as const, length: 100_000, getLine: () => {
      reads++;
      return { isWrapped: false, translateToString: (_trim?: boolean, _start?: number, end?: number) => `❯ ${"x".repeat(1000)}`.slice(0, end) };
    } };
    const entries = scanPromptPreviews(large);
    expect(entries).toHaveLength(48);
    expect(entries[47].line).toBe(99_999);
    expect(entries.every((entry) => entry.excerpt.length <= 240)).toBe(true);
    expect(reads).toBeLessThanOrEqual(6000);
    expect(scanPromptPreviews({ ...large, type: "alternate" })).toEqual([]);
  });
  it("uses nonempty unwrapped prompt first lines without collecting assistant output", () => {
    expect(scanPromptPreviews(buffer(["❯ explain this", "assistant answer", ["> continuation fake", true], "> second", "❯ "]))).toEqual([
      { line: 0, excerpt: "explain this" }, { line: 3, excerpt: "second" },
    ]);
  });
});
