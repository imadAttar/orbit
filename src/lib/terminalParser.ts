/**
 * Terminal output parser — shared infrastructure for cost tracking,
 * file path detection, and completion detection.
 */

/**
 * Strip ANSI escape sequences from terminal output.
 * Handles CSI, OSC, title sequences, and other control codes.
 */
export function stripAnsi(text: string): string {
  return text
    // OSC sequences (e.g. title set): ESC ] ... BEL or ESC ] ... ST
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
    // CSI sequences: ESC [ ... letter
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    // Other escape sequences (SS2, SS3, etc.)
    .replace(/\x1b[()#][A-Z0-9]/g, "")
    // Single-char escapes
    .replace(/\x1b[=>NOM78]/g, "")
    // Remaining ESC + single char
    .replace(/\x1b./g, "")
    // BEL, carriage return
    .replace(/[\x07]/g, "");
}

