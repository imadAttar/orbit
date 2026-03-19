export type Session = {
  id: string;
  name: string;
  claudeSessionId?: string; // Claude Code CLI session UUID for --resume
  dangerousMode?: boolean; // true = yolo mode (skip all permission prompts)
};

export type Project = {
  id: string;
  name: string;
  dir: string;
  sessions: Session[];
  bookmarks?: Bookmark[];
};

export type TerminalPref =
  | "iterm2" | "ghostty"                    // macOS
  | "windows-terminal" | "powershell"       // Windows
  | "gnome-terminal" | "konsole"            // Linux
  | "default";                              // system default

export type EditorPref =
  | "vscode" | "cursor" | "zed"
  | "intellij" | "webstorm" | "goland" | "pycharm"
  | "sublime" | "nvim" | "emacs"
  | "default";

export type { ThemeName } from "../lib/themes";

export type Bookmark = {
  id: string;
  name: string;
  prompt: string;
  description?: string;
};

export type SplitLayout = {
  type: "horizontal" | "vertical" | "none";
  primarySid: string;
  secondarySid?: string;
  ratio: number;
};

export type SessionMode = "normal" | "yolo";
export type Language = "fr" | "en";

export type Settings = {
  terminal: TerminalPref;
  editor: EditorPref;
  theme: import("../lib/themes").ThemeName;
  fontSize: number;
  sidebarWidth: number;
  analytics: boolean;
  statuslineAsked: boolean;
  autoUpdate: boolean;
  defaultMode: SessionMode;
  language: Language;
};
