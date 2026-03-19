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

/**
 * Extract cost (USD) from terminal output.
 * Claude Code statusline shows cost as `$X.XX`.
 */
export function extractCost(text: string): number | null {
  const clean = stripAnsi(text);
  // Match $X.XX pattern — last occurrence is the most recent
  const matches = clean.match(/\$(\d+\.\d{2})/g);
  if (!matches || matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const value = parseFloat(last.slice(1));
  return isNaN(value) ? null : value;
}

/**
 * Detect file paths in terminal output.
 * Returns array of { path, line } objects.
 */
export interface FileRef {
  path: string;
  line?: number;
  col?: number;
}

// Regex pattern for absolute and relative file paths with optional :line:col
const FILE_PATH_PATTERN = /(?:^|\s)((?:\/|\.\/|\.\.\/|[a-zA-Z]:\\)[\w./_\\-]+(?:\.[a-zA-Z0-9]+))(?::(\d+))?(?::(\d+))?/g;

export function extractFilePaths(text: string): FileRef[] {
  const clean = stripAnsi(text);
  const results: FileRef[] = [];
  let match;
  // Create a fresh regex each call to avoid stateful lastIndex issues
  const re = new RegExp(FILE_PATH_PATTERN.source, FILE_PATH_PATTERN.flags);
  while ((match = re.exec(clean)) !== null) {
    results.push({
      path: match[1],
      line: match[2] ? parseInt(match[2]) : undefined,
      col: match[3] ? parseInt(match[3]) : undefined,
    });
  }
  return results;
}

/**
 * Extract context usage percentage from statusline JSON sidecar or output.
 */
export function extractContextPct(text: string): number | null {
  const clean = stripAnsi(text);
  const match = clean.match(/(\d+)%%?\s*$/m) ?? clean.match(/(\d+)%/);
  if (!match) return null;
  const val = parseInt(match[1]);
  return val >= 0 && val <= 100 ? val : null;
}
