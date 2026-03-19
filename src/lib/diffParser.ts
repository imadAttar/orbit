/**
 * Simple diff parser — transforms unified diff into structured hunks.
 * Used by DiffViewer for side-by-side rendering.
 */

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "add" | "del" | "context";
  content: string;
}

export function parseDiff(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = diff.split("\n");
  let current: DiffHunk | null = null;

  for (const line of lines) {
    const hunkHeader = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkHeader) {
      current = {
        oldStart: parseInt(hunkHeader[1]),
        oldLines: parseInt(hunkHeader[2] ?? "1"),
        newStart: parseInt(hunkHeader[3]),
        newLines: parseInt(hunkHeader[4] ?? "1"),
        lines: [],
      };
      hunks.push(current);
      continue;
    }

    if (!current) continue;

    if (line.startsWith("+")) {
      current.lines.push({ type: "add", content: line.slice(1) });
    } else if (line.startsWith("-")) {
      current.lines.push({ type: "del", content: line.slice(1) });
    } else if (line.startsWith(" ")) {
      current.lines.push({ type: "context", content: line.slice(1) });
    }
  }

  return hunks;
}
