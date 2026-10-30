import { describe, it, expect } from "vitest";
import { stripAnsi } from "../../lib/terminalParser";

describe("terminalParser", () => {
  describe("stripAnsi", () => {
    it("removes CSI sequences", () => {
      expect(stripAnsi("\x1b[31mhello\x1b[0m")).toBe("hello");
    });

    it.each([
      "\x1b[<35;189;7M\x1b[<35;181;10M\x1b[<35;177;11M",
      "\x1b[<0;12;8m",
      "\x1b[38:2::255:0:0m",
      "\x1b[>0;10;1c\x1b[?1;2c",
      "\x1b[!p\x1b[2 q\x1b[1$z",
      "\x1b[200~\x1b[201~\x1b[2@",
    ])("removes the complete CSI byte grammar: %j", (sequence) => {
      expect(stripAnsi(`before${sequence}after`)).toBe("beforeafter");
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
