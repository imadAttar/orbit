import type { ITheme } from "@xterm/xterm";

export type ThemeName =
  | "orbit"
  | "orbit-light"
  | "catppuccin-macchiato"
  | "dracula"
  | "one-dark"
  | "nord"
  | "tokyo-night"
  | "gruvbox-dark"
  | "rose-pine";

export interface AppTheme {
  label: string;
  terminal: ITheme;
  chrome: {
    bg: string;
    sidebarBg: string;
    border: string;
    accent: string;
    sessionActive: string;
    codeBg: string;
    text: string;
    textDim: string;
    textBright: string;
    green: string;
    yellow: string;
    danger: string;
  };
}

export const THEMES: Record<ThemeName, AppTheme> = {
  orbit: {
    label: "Orbit",
    terminal: {
      background: "#151a23",
      foreground: "#cdd5de",
      cursor: "#4d9de6",
      cursorAccent: "#151a23",
      selectionBackground: "#1f3a5c",
      black: "#1c2330",
      red: "#e06b74",
      green: "#7cc88e",
      yellow: "#d4a64e",
      blue: "#4d9de6",
      magenta: "#b09adf",
      cyan: "#5fbdce",
      white: "#cdd5de",
      brightBlack: "#4a5567",
      brightRed: "#ea868f",
      brightGreen: "#97d8a6",
      brightYellow: "#e4c06a",
      brightBlue: "#6db3f0",
      brightMagenta: "#c9b5ec",
      brightCyan: "#7dd0de",
      brightWhite: "#eaf0f6",
    },
    chrome: {
      bg: "#0e1219",
      sidebarBg: "#121821",
      border: "#1e2632",
      accent: "#4d9de6",
      sessionActive: "rgba(77, 157, 230, 0.07)",
      codeBg: "#0b0f15",
      text: "#a0aab8",
      textDim: "#546070",
      textBright: "#e2e8f0",
      green: "#7cc88e",
      yellow: "#d4a64e",
      danger: "#e06b74",
    },
  },

  "orbit-light": {
    label: "Orbit Light",
    terminal: {
      background: "#d8dde4",
      foreground: "#1a2030",
      cursor: "#2471b4",
      cursorAccent: "#d8dde4",
      selectionBackground: "#a8c4e0",
      black: "#1a2030",
      red: "#b83a3a",
      green: "#1c7a3c",
      yellow: "#8a6100",
      blue: "#2471b4",
      magenta: "#6f42a0",
      cyan: "#0f7b96",
      white: "#c5ccd4",
      brightBlack: "#5c6675",
      brightRed: "#cc4444",
      brightGreen: "#258c48",
      brightYellow: "#a07400",
      brightBlue: "#2e85cc",
      brightMagenta: "#8556b8",
      brightCyan: "#1490af",
      brightWhite: "#eaecf0",
    },
    chrome: {
      bg: "#cdd3da",
      sidebarBg: "#c3cad2",
      border: "#aeb8c4",
      accent: "#2471b4",
      sessionActive: "rgba(36, 113, 180, 0.10)",
      codeBg: "#c3cad2",
      text: "#242e3c",
      textDim: "#4e5968",
      textBright: "#0e1620",
      green: "#1c7a3c",
      yellow: "#8a6100",
      danger: "#b83a3a",
    },
  },

  "catppuccin-macchiato": {
    label: "Catppuccin Macchiato",
    terminal: {
      background: "#24273a",
      foreground: "#cad3f5",
      cursor: "#f4dbd6",
      cursorAccent: "#24273a",
      selectionBackground: "#363a4f",
      black: "#494d64",
      red: "#ed8796",
      green: "#a6da95",
      yellow: "#eed49f",
      blue: "#8aadf4",
      magenta: "#f5bde6",
      cyan: "#8bd5ca",
      white: "#cad3f5",
      brightBlack: "#5b6078",
      brightRed: "#ed8796",
      brightGreen: "#a6da95",
      brightYellow: "#eed49f",
      brightBlue: "#8aadf4",
      brightMagenta: "#f5bde6",
      brightCyan: "#8bd5ca",
      brightWhite: "#ffffff",
    },
    chrome: {
      bg: "#1e2030",
      sidebarBg: "#181926",
      border: "#363a4f",
      accent: "#8aadf4",
      sessionActive: "rgba(138, 173, 244, 0.08)",
      codeBg: "#181926",
      text: "#cad3f5",
      textDim: "#5b6078",
      textBright: "#f4dbd6",
      green: "#a6da95",
      yellow: "#eed49f",
      danger: "#ed8796",
    },
  },

  dracula: {
    label: "Dracula",
    terminal: {
      background: "#282a36",
      foreground: "#f8f8f2",
      cursor: "#f8f8f2",
      cursorAccent: "#282a36",
      selectionBackground: "#44475a",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
    chrome: {
      bg: "#282a36",
      sidebarBg: "#21222c",
      border: "#44475a",
      accent: "#bd93f9",
      sessionActive: "#3a3450",
      codeBg: "#1e1f29",
      text: "#f8f8f2",
      textDim: "#6272a4",
      textBright: "#ffffff",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      danger: "#ff5555",
    },
  },

  "one-dark": {
    label: "One Dark",
    terminal: {
      background: "#282c34",
      foreground: "#abb2bf",
      cursor: "#528bff",
      cursorAccent: "#282c34",
      selectionBackground: "#3e4451",
      black: "#3f4451",
      red: "#e06c75",
      green: "#98c379",
      yellow: "#e5c07b",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#abb2bf",
      brightBlack: "#5c6370",
      brightRed: "#e06c75",
      brightGreen: "#98c379",
      brightYellow: "#e5c07b",
      brightBlue: "#61afef",
      brightMagenta: "#c678dd",
      brightCyan: "#56b6c2",
      brightWhite: "#ffffff",
    },
    chrome: {
      bg: "#282c34",
      sidebarBg: "#21252b",
      border: "#3e4451",
      accent: "#61afef",
      sessionActive: "#2c3344",
      codeBg: "#1e2127",
      text: "#abb2bf",
      textDim: "#5c6370",
      textBright: "#ffffff",
      green: "#98c379",
      yellow: "#e5c07b",
      danger: "#e06c75",
    },
  },

  nord: {
    label: "Nord",
    terminal: {
      background: "#2e3440",
      foreground: "#d8dee9",
      cursor: "#d8dee9",
      cursorAccent: "#2e3440",
      selectionBackground: "#434c5e",
      black: "#3b4252",
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#e5e9f0",
      brightBlack: "#4c566a",
      brightRed: "#bf616a",
      brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b",
      brightBlue: "#81a1c1",
      brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb",
      brightWhite: "#eceff4",
    },
    chrome: {
      bg: "#2e3440",
      sidebarBg: "#292e39",
      border: "#3b4252",
      accent: "#88c0d0",
      sessionActive: "#2e3a4a",
      codeBg: "#242932",
      text: "#d8dee9",
      textDim: "#4c566a",
      textBright: "#eceff4",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      danger: "#bf616a",
    },
  },

  "tokyo-night": {
    label: "Tokyo Night",
    terminal: {
      background: "#1a1b26",
      foreground: "#c0caf5",
      cursor: "#c0caf5",
      cursorAccent: "#1a1b26",
      selectionBackground: "#33467c",
      black: "#15161e",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    },
    chrome: {
      bg: "#1a1b26",
      sidebarBg: "#16161e",
      border: "#292e42",
      accent: "#7aa2f7",
      sessionActive: "#1f2a48",
      codeBg: "#13131e",
      text: "#a9b1d6",
      textDim: "#414868",
      textBright: "#c0caf5",
      green: "#9ece6a",
      yellow: "#e0af68",
      danger: "#f7768e",
    },
  },

  "gruvbox-dark": {
    label: "Gruvbox Dark",
    terminal: {
      background: "#282828",
      foreground: "#ebdbb2",
      cursor: "#ebdbb2",
      cursorAccent: "#282828",
      selectionBackground: "#3c3836",
      black: "#282828",
      red: "#cc241d",
      green: "#98971a",
      yellow: "#d79921",
      blue: "#458588",
      magenta: "#b16286",
      cyan: "#689d6a",
      white: "#a89984",
      brightBlack: "#928374",
      brightRed: "#fb4934",
      brightGreen: "#b8bb26",
      brightYellow: "#fabd2f",
      brightBlue: "#83a598",
      brightMagenta: "#d3869b",
      brightCyan: "#8ec07c",
      brightWhite: "#ebdbb2",
    },
    chrome: {
      bg: "#282828",
      sidebarBg: "#1d2021",
      border: "#3c3836",
      accent: "#d79921",
      sessionActive: "#3c3520",
      codeBg: "#1a1a1a",
      text: "#ebdbb2",
      textDim: "#928374",
      textBright: "#fbf1c7",
      green: "#b8bb26",
      yellow: "#fabd2f",
      danger: "#fb4934",
    },
  },

  "rose-pine": {
    label: "Rose Pine",
    terminal: {
      background: "#191724",
      foreground: "#e0def4",
      cursor: "#56526e",
      cursorAccent: "#e0def4",
      selectionBackground: "#2a283e",
      black: "#26233a",
      red: "#eb6f92",
      green: "#31748f",
      yellow: "#f6c177",
      blue: "#9ccfd8",
      magenta: "#c4a7e7",
      cyan: "#ebbcba",
      white: "#e0def4",
      brightBlack: "#6e6a86",
      brightRed: "#eb6f92",
      brightGreen: "#31748f",
      brightYellow: "#f6c177",
      brightBlue: "#9ccfd8",
      brightMagenta: "#c4a7e7",
      brightCyan: "#ebbcba",
      brightWhite: "#e0def4",
    },
    chrome: {
      bg: "#191724",
      sidebarBg: "#1f1d2e",
      border: "#26233a",
      accent: "#c4a7e7",
      sessionActive: "#2a2540",
      codeBg: "#15121f",
      text: "#e0def4",
      textDim: "#6e6a86",
      textBright: "#e0def4",
      green: "#31748f",
      yellow: "#f6c177",
      danger: "#eb6f92",
    },
  },
};

export function applyChrome(theme: AppTheme) {
  const r = document.documentElement.style;
  const c = theme.chrome;
  r.setProperty("--bg", c.bg);
  r.setProperty("--sidebar-bg", c.sidebarBg);
  r.setProperty("--border", c.border);
  r.setProperty("--accent", c.accent);
  r.setProperty("--session-active", c.sessionActive);
  r.setProperty("--code-bg", c.codeBg);
  r.setProperty("--text", c.text);
  r.setProperty("--text-dim", c.textDim);
  r.setProperty("--text-bright", c.textBright);
  r.setProperty("--green", c.green);
  r.setProperty("--yellow", c.yellow);
  r.setProperty("--danger", c.danger);
  // Derived vars used in CSS but not defined per-theme
  r.setProperty("--bg-hover", `${c.sidebarBg}`);
  r.setProperty("--bg-active", `${c.border}`);
  r.setProperty("--bg-alt", `${c.codeBg}`);
  // Parse hex to RGB for rgba() usage
  const toRgb = (hex: string) => {
    const h = hex.replace("#", "");
    if (h.length !== 6) return null;
    return `${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}`;
  };
  const accentRgb = toRgb(c.accent);
  if (accentRgb) r.setProperty("--accent-rgb", accentRgb);
  const dangerRgb = toRgb(c.danger);
  if (dangerRgb) r.setProperty("--danger-rgb", dangerRgb);
  const greenRgb = toRgb(c.green);
  if (greenRgb) r.setProperty("--green-rgb", greenRgb);
  const yellowRgb = toRgb(c.yellow);
  if (yellowRgb) r.setProperty("--yellow-rgb", yellowRgb);
  // Derived dim/glow vars that depend on accent-rgb
  r.setProperty("--accent-glow", `rgba(${accentRgb}, 0.15)`);
  r.setProperty("--accent-dim", `rgba(${accentRgb}, 0.06)`);
  r.setProperty("--session-active", c.sessionActive);
}
