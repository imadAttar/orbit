const ua = navigator.userAgent.toLowerCase();

export const isMac = ua.includes("mac");
export const isWindows = ua.includes("windows");
export const isLinux = !isMac && !isWindows;

export const modLabel = isMac ? "Cmd" : "Ctrl";
export const modSymbol = isMac ? "\u2318" : "Ctrl+";

type TerminalOption = { value: string; label: string };

export const terminalOptions: TerminalOption[] = isMac
  ? [
      { value: "iterm2", label: "iTerm2" },
      { value: "ghostty", label: "Ghostty" },
      { value: "default", label: "Terminal (systeme)" },
    ]
  : isWindows
    ? [
        { value: "windows-terminal", label: "Windows Terminal" },
        { value: "powershell", label: "PowerShell" },
        { value: "default", label: "CMD" },
      ]
    : [
        { value: "gnome-terminal", label: "GNOME Terminal" },
        { value: "konsole", label: "Konsole" },
        { value: "default", label: "xterm" },
      ];

export const defaultTerminal = terminalOptions[0].value;
