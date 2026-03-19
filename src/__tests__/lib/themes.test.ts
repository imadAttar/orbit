import { describe, it, expect } from "vitest";
import { THEMES, applyChrome, type ThemeName, type AppTheme } from "../../lib/themes";

const CHROME_KEYS: (keyof AppTheme["chrome"])[] = [
  "bg",
  "sidebarBg",
  "border",
  "accent",
  "sessionActive",
  "codeBg",
  "text",
  "textDim",
  "textBright",
  "green",
  "yellow",
  "danger",
];

const TERMINAL_KEYS = [
  "background",
  "foreground",
  "cursor",
  "cursorAccent",
  "selectionBackground",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
];

describe("themes", () => {
  const themeNames = Object.keys(THEMES) as ThemeName[];

  it("has at least one theme", () => {
    expect(themeNames.length).toBeGreaterThan(0);
  });

  for (const name of themeNames) {
    describe(name, () => {
      it("has all chrome keys", () => {
        const theme = THEMES[name];
        for (const key of CHROME_KEYS) {
          expect(theme.chrome[key], `missing chrome.${key}`).toBeTruthy();
        }
      });

      it("has all terminal keys", () => {
        const theme = THEMES[name];
        for (const key of TERMINAL_KEYS) {
          expect(
            theme.terminal[key as keyof typeof theme.terminal],
            `missing terminal.${key}`
          ).toBeTruthy();
        }
      });

      it("has a label", () => {
        expect(THEMES[name].label).toBeTruthy();
      });
    });
  }
});

describe("applyChrome", () => {
  it("sets CSS custom properties on documentElement", () => {
    const theme = THEMES["dracula"];
    applyChrome(theme);

    const style = document.documentElement.style;
    expect(style.getPropertyValue("--bg")).toBe(theme.chrome.bg);
    expect(style.getPropertyValue("--sidebar-bg")).toBe(theme.chrome.sidebarBg);
    expect(style.getPropertyValue("--border")).toBe(theme.chrome.border);
    expect(style.getPropertyValue("--accent")).toBe(theme.chrome.accent);
    expect(style.getPropertyValue("--session-active")).toBe(theme.chrome.sessionActive);
    expect(style.getPropertyValue("--code-bg")).toBe(theme.chrome.codeBg);
    expect(style.getPropertyValue("--text")).toBe(theme.chrome.text);
    expect(style.getPropertyValue("--text-dim")).toBe(theme.chrome.textDim);
    expect(style.getPropertyValue("--text-bright")).toBe(theme.chrome.textBright);
    expect(style.getPropertyValue("--green")).toBe(theme.chrome.green);
    expect(style.getPropertyValue("--yellow")).toBe(theme.chrome.yellow);
    expect(style.getPropertyValue("--danger")).toBe(theme.chrome.danger);
  });
});
