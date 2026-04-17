import { describe, it, expect } from "vitest";
import { stripAnsi } from "../../lib/terminalParser";

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
});
