import { describe, expect, it } from "vitest";
import { terminalPreviewLinks } from "../../features/preview/terminalLinks";
describe("preview link detection does not reinterpret Claude output", () => {
  it("recognizes explicit URLs and file references without overlapping them", () => {
    const text = "Visit http://localhost:3000/docs and read docs/README.md:12 or /project/app.ts:9:2";
    const links = terminalPreviewLinks(text);
    expect(links.map(l => l.target)).toEqual([{ type: "url", url: "http://localhost:3000/docs" }, { type: "file", path: "docs/README.md" }, { type: "file", path: "/project/app.ts" }]);
    expect(links[1].line).toBe(12);
    expect(text.slice(links[0].startIndex, links[0].startIndex + links[0].length)).toBe("http://localhost:3000/docs");
  });
  it("makes a bare Markdown filename clickable and excludes credential-bearing URLs", () => {
    expect(terminalPreviewLinks("`README.md`" )[0].target).toEqual({ type: "file", path: "README.md" });
    expect(terminalPreviewLinks("https://user:password@example.com")).toEqual([]);
  });
});
