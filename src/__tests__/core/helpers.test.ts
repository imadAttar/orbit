import { describe, it, expect } from "vitest";

// prevDirName mirrors src/NewProjectModal.tsx — cross-platform split
function prevDirName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || "";
}

describe("prevDirName", () => {
  it("returns last directory name", () => {
    expect(prevDirName("/foo/bar/baz")).toBe("baz");
  });

  it("handles trailing slash", () => {
    expect(prevDirName("/foo/bar/")).toBe("bar");
  });

  it("handles single component", () => {
    expect(prevDirName("/foo")).toBe("foo");
  });

  it("handles root path", () => {
    expect(prevDirName("/")).toBe("");
  });

  it("handles multiple trailing slashes", () => {
    expect(prevDirName("/foo/bar///")).toBe("bar");
  });

  it("handles Windows backslash paths", () => {
    expect(prevDirName("C:\\Users\\foo\\bar")).toBe("bar");
  });

  it("handles Windows trailing backslash", () => {
    expect(prevDirName("C:\\Users\\foo\\")).toBe("foo");
  });

  it("handles mixed separators", () => {
    expect(prevDirName("C:\\Users/foo\\bar")).toBe("bar");
  });
});
