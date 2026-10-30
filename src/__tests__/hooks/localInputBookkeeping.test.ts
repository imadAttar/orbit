import { describe, expect, it } from "vitest";
import { LocalInputBookkeeping } from "../../features/terminal/hooks/localInputBookkeeping";

describe("local input bookkeeping", () => {
  it.each([
    "\x1b[<35;189;7M\x1b[<0;189;7m", // SGR move/release
    "\x1b[A\x1b[1;5D\x1b[12;34R\x1b[?1;2c\x1b[>0;10;1c",
    "\x1bOP\x1bOA", // SS3 function/arrow keys
    "\x1b]0;untrusted title\x07",
    "\x1b]52;c;untrusted clipboard\x1b\\",
    "\x1bP1$rcontrol response\x1b\\",
    "\x1b_hidden APC\x1b\\\x1b^hidden PM\x1b\\\x1bXhidden SOS\x1b\\",
    "\x1b(B\x1b#8", // ESC intermediate sequences
    "\x9b<35;189;7M\x9d0;hidden\x9c", // 8-bit CSI/OSC/ST
    "\x1b[M !!", // legacy X10 mouse payload
  ])("discards complete and arbitrarily fragmented reports %j", (report) => {
    for (let split = 0; split <= report.length; split++) {
      const parser = new LocalInputBookkeeping();
      expect(parser.feed(report.slice(0, split))).toEqual([]);
      expect(parser.feed(report.slice(split))).toEqual([]);
      expect(parser.feed("\r")).toEqual([""]);
      parser.feed("inputtypedtest");
      expect(parser.feed("\r")).toEqual(["inputtypedtest"]);
    }
  });
  it("keeps fragmented paste delimiters and pasted newlines local until explicit Enter", () => {
    const parser = new LocalInputBookkeeping();
    for (const char of "\x1b[200~fix\nprivate\x1b[201~") expect(parser.feed(char)).toEqual([]);
    expect(parser.feed("\r")).toEqual(["fix\nprivate"]);
  });
  it("recognizes a standalone Enter segment after a paste delimiter in the same callback", () => {
    const parser = new LocalInputBookkeeping();
    expect(parser.feed("\x1b[200~inputtypedtest\x1b[201~\r")).toEqual(["inputtypedtest"]);
  });
  it("keeps unbracketed multiline paste as text, not implicit submits", () => {
    const parser = new LocalInputBookkeeping();
    expect(parser.feed("fix\nprivate")).toEqual([]);
    expect(parser.feed("\r")).toEqual(["fix\nprivate"]);
  });
  it("preserves backspace, Ctrl-U and Ctrl-C editing without keeping their bytes", () => {
    const parser = new LocalInputBookkeeping();
    parser.feed("wrong\x15also wrong\x03inputtypedtest!\x7f?\b");
    expect(parser.feed("\r")).toEqual(["inputtypedtest"]);
  });
  it("bounds text and discards oversized or incomplete control payloads without flushing them as text", () => {
    const parser = new LocalInputBookkeeping();
    parser.feed("\x1b[<" + "1;".repeat(10000));
    parser.feed("7M");
    expect(parser.feed("\r")).toEqual([""]);
    parser.feed("x".repeat(10000));
    expect(parser.feed("\r")).toEqual(["x".repeat(4096)]);
    parser.feed("\x1b]" + "untrusted".repeat(10000));
    expect(parser.feed("\r")).toEqual([]);
    parser.feed("\x1b\\real text");
    expect(parser.feed("\r")).toEqual(["real text"]);
  });
  it("cancels an incomplete CSI on a control byte without leaking parameters", () => {
    const parser = new LocalInputBookkeeping();
    parser.feed("\x1b[<35;189;");
    expect(parser.feed("\r")).toEqual([]);
    parser.feed("real text");
    expect(parser.feed("\r")).toEqual(["real text"]);
  });
});
