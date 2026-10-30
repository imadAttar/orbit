import { describe, expect, it } from "vitest";
import { normalizePreviewUrl, previewReducer, EMPTY_PREVIEW, resolvePreviewLink } from "../../features/preview/previewModel";

describe("isolated preview navigation", () => {
  it("resolves Markdown links without escaping a project or allowing executable schemes", () => {
    expect(resolvePreviewLink("../README.md", "docs/guide.md")).toEqual({ type: "file", path: "README.md" });
    expect(resolvePreviewLink("notes%20finales.md", "docs/guide.md")).toEqual({ type: "file", path: "docs/notes finales.md" });
    expect(resolvePreviewLink("../../outside.md", "docs/guide.md")).toBeNull();
    expect(resolvePreviewLink("javascript:alert(1)", "README.md")).toBeNull();
    expect(resolvePreviewLink("https://example.com", "README.md")).toEqual({ type: "url", url: "https://example.com/" });
  });
  it("normalizes explicit sites and local development addresses", () => {
    expect(normalizePreviewUrl("example.com/docs")).toBe("https://example.com/docs");
    expect(normalizePreviewUrl("localhost:3000")).toBe("http://localhost:3000/");
    expect(normalizePreviewUrl("http://127.0.0.1:5173/test")).toBe("http://127.0.0.1:5173/test");
  });
  it.each(["javascript:alert(1)", "file:///etc/passwd", "data:text/html,secret", "https://user:pass@example.com", "https://example.com\n", "http://localhost:1420", "http://tauri.localhost", "https://asset.localhost", "https://exa\\mple.com"])("rejects unsafe or privileged origins: %s", url => {
    expect(() => normalizePreviewUrl(url)).toThrow();
  });
  it("keeps browser history distinct from file selection", () => {
    let view = previewReducer(EMPTY_PREVIEW, { type: "url", url: "https://example.com/one" });
    view = previewReducer(view, { type: "url", url: "https://example.com/two" });
    view = previewReducer(view, { type: "back" });
    expect(view.history[view.historyIndex]).toBe("https://example.com/one");
    view = previewReducer(view, { type: "url", url: "https://example.com/three" });
    expect(view.history).toEqual(["https://example.com/one", "https://example.com/three"]);
    view = previewReducer(view, { type: "file", path: "docs/README.md" });
    expect(view.mode).toBe("files");
    expect(view.path).toBe("docs/README.md");
    expect(view.history).toHaveLength(2);
    expect(view.open).toBe(true);
  });
});
