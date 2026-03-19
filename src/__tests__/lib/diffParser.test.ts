import { describe, it, expect } from "vitest";
import { parseDiff } from "../../lib/diffParser";

describe("parseDiff", () => {
  it("parses a single hunk with add/del/context lines", () => {
    const diff = [
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,3 +1,3 @@",
      " const a = 1;",
      "-const b = 2;",
      "+const b = 3;",
      " const c = 4;",
    ].join("\n");

    const hunks = parseDiff(diff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].oldStart).toBe(1);
    expect(hunks[0].oldLines).toBe(3);
    expect(hunks[0].newStart).toBe(1);
    expect(hunks[0].newLines).toBe(3);
    expect(hunks[0].lines).toHaveLength(4);
    expect(hunks[0].lines[0]).toEqual({ type: "context", content: "const a = 1;" });
    expect(hunks[0].lines[1]).toEqual({ type: "del", content: "const b = 2;" });
    expect(hunks[0].lines[2]).toEqual({ type: "add", content: "const b = 3;" });
    expect(hunks[0].lines[3]).toEqual({ type: "context", content: "const c = 4;" });
  });

  it("parses multiple hunks", () => {
    const diff = [
      "@@ -1,2 +1,2 @@",
      "-old1",
      "+new1",
      " same",
      "@@ -10,2 +10,2 @@",
      "-old2",
      "+new2",
      " same2",
    ].join("\n");

    const hunks = parseDiff(diff);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].oldStart).toBe(1);
    expect(hunks[1].oldStart).toBe(10);
  });

  it("handles hunk header with omitted line count (defaults to 1)", () => {
    const diff = "@@ -5 +5 @@\n-old\n+new";
    const hunks = parseDiff(diff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].oldLines).toBe(1);
    expect(hunks[0].newLines).toBe(1);
  });

  it("returns empty array for empty input", () => {
    expect(parseDiff("")).toHaveLength(0);
  });

  it("returns empty array for header-only diff", () => {
    const diff = "--- a/file.ts\n+++ b/file.ts";
    expect(parseDiff(diff)).toHaveLength(0);
  });

  it("handles additions only", () => {
    const diff = "@@ -0,0 +1,2 @@\n+line1\n+line2";
    const hunks = parseDiff(diff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines).toHaveLength(2);
    expect(hunks[0].lines.every((l) => l.type === "add")).toBe(true);
  });

  it("handles deletions only", () => {
    const diff = "@@ -1,2 +0,0 @@\n-line1\n-line2";
    const hunks = parseDiff(diff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines).toHaveLength(2);
    expect(hunks[0].lines.every((l) => l.type === "del")).toBe(true);
  });

  it("strips the leading +/-/space from content", () => {
    const diff = "@@ -1,1 +1,1 @@\n-  indented";
    const hunks = parseDiff(diff);
    expect(hunks[0].lines[0].content).toBe("  indented");
  });
});
