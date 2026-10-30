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
    // ECMA-48 CSI: parameter bytes, intermediate bytes, then a final byte.
    // Includes private parameters such as '<' in SGR mouse reports.
    .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "")
    // Other escape sequences (SS2, SS3, etc.)
    .replace(/\x1b[()#][A-Z0-9]/g, "")
    // Single-char escapes
    .replace(/\x1b[=>NOM78]/g, "")
    // Remaining ESC + single char
    .replace(/\x1b./g, "")
    // BEL, carriage return
    .replace(/[\x07]/g, "");
}

