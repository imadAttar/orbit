import { describe, it, expect } from "vitest";
import { stripAnsi, extractCost, extractFilePaths, extractContextPct } from "../../lib/terminalParser";

describe("terminalParser", () => {
  describe("stripAnsi", () => {
    it("removes CSI sequences", () => {
      expect(stripAnsi("\x1b[31mhello\x1b[0m")).toBe("hello");
    });

    it("removes OSC sequences (title set)", () => {
      expect(stripAnsi("\x1b]0;My Title\x07text")).toBe("text");
    });

    it("removes OSC sequences with ST terminator", () => {
      expect(stripAnsi("\x1b]0;Title\x1b\\text")).toBe("text");
    });

    it("handles mixed ANSI and plain text", () => {
      expect(stripAnsi("abc\x1b[1m\x1b[32mdef\x1b[0mghi")).toBe("abcdefghi");
    });

    it("returns plain text unchanged", () => {
      expect(stripAnsi("hello world")).toBe("hello world");
    });

    it("handles empty string", () => {
      expect(stripAnsi("")).toBe("");
    });

    it("removes BEL character", () => {
      expect(stripAnsi("hello\x07world")).toBe("helloworld");
    });
  });

  describe("extractCost", () => {
    it("extracts cost from statusline output", () => {
      expect(extractCost("Opus $1.23 50%")).toBe(1.23);
    });

    it("returns last cost when multiple present", () => {
      expect(extractCost("$0.10 stuff $2.50")).toBe(2.50);
    });

    it("returns null when no cost found", () => {
      expect(extractCost("no cost here")).toBeNull();
    });

    it("works with ANSI-colored output", () => {
      expect(extractCost("\x1b[33m$3.14\x1b[0m")).toBe(3.14);
    });

    it("handles zero cost", () => {
      expect(extractCost("$0.00")).toBe(0);
    });
  });

  describe("extractFilePaths", () => {
    it("extracts absolute path", () => {
      const refs = extractFilePaths("see /Users/foo/bar.ts for details");
      expect(refs).toHaveLength(1);
      expect(refs[0].path).toBe("/Users/foo/bar.ts");
    });

    it("extracts path with line number", () => {
      const refs = extractFilePaths("error at /src/app.ts:42");
      expect(refs).toHaveLength(1);
      expect(refs[0].path).toBe("/src/app.ts");
      expect(refs[0].line).toBe(42);
    });

    it("extracts path with line and column", () => {
      const refs = extractFilePaths("error at /src/app.ts:42:10");
      expect(refs).toHaveLength(1);
      expect(refs[0].line).toBe(42);
      expect(refs[0].col).toBe(10);
    });

    it("extracts relative paths", () => {
      const refs = extractFilePaths("see ./src/foo.ts and ../bar.js");
      expect(refs).toHaveLength(2);
      expect(refs[0].path).toBe("./src/foo.ts");
      expect(refs[1].path).toBe("../bar.js");
    });

    it("returns empty array for no paths", () => {
      expect(extractFilePaths("no paths here")).toHaveLength(0);
    });
  });

  describe("extractContextPct", () => {
    it("extracts percentage", () => {
      expect(extractContextPct("50%")).toBe(50);
    });

    it("returns null for no match", () => {
      expect(extractContextPct("no percentage")).toBeNull();
    });

    it("rejects out-of-range values", () => {
      expect(extractContextPct("150%")).toBeNull();
    });

    it("extracts percentage with double percent (printf-style)", () => {
      expect(extractContextPct("50%%")).toBe(50);
    });
  });
});
