export interface PromptBuffer {
  type: "normal" | "alternate";
  length: number;
  getLine(line: number): { isWrapped: boolean; translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string } | undefined;
}
export interface PromptPreview { line: number; excerpt: string }

/** A best-effort rendered marker, never a structured user message. First line only. */
export function scanPromptPreviews(buffer: PromptBuffer): PromptPreview[] {
  const entries: PromptPreview[] = [];
  if (buffer.type !== "normal") return entries;
  // Walk newest first: bounded work even on a very large restored scrollback.
  for (let line = buffer.length - 1; line >= Math.max(0, buffer.length - 6000) && entries.length < 48; line--) {
    const row = buffer.getLine(line);
    if (!row || row.isWrapped) continue;
    const match = /^(?:❯|>)\s+(.+)$/.exec(row.translateToString(true, 0, 242));
    const excerpt = match?.[1].trim().slice(0, 240);
    if (excerpt) entries.push({ line, excerpt });
  }
  return entries.reverse();
}
