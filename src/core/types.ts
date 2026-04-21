export type SessionType = "claude" | "terminal";

export type Session = {
  id: string;
  name: string;
  type?: SessionType; // "claude" (default) or "terminal" (plain shell, no Claude)
  claudeSessionId?: string; // Claude Code CLI session UUID for --resume
  dangerousMode?: boolean; // true = yolo mode (skip all permission prompts)
  hasConversation?: boolean; // true once the user has sent at least one prompt; gates --resume
};

export type Project = {
  id: string;
  name: string;
  dir: string;
  sessions: Session[];
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
  autoNotifications: boolean;
};
