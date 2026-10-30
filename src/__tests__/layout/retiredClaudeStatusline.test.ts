import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "src");

describe("retired Claude status-line integration", () => {
  it("does not mount or retain the custom status-line metrics consumer", () => {
    const app = readFileSync(resolve(root, "App.tsx"), "utf8");
    expect(app).not.toContain("ContextBar");
    expect(existsSync(resolve(root, "layout/ContextBar.tsx"))).toBe(false);
  });
  it("preserves Orbit's own application status bar", () => {
    const app = readFileSync(resolve(root, "App.tsx"), "utf8");
    expect(app).toContain('import StatusBar from "./layout/StatusBar"');
    expect(app).toContain("<StatusBar />");
  });
});
