import { useEffect, useRef, useState } from "react";
import type { IMarker, Terminal as XTerm } from "@xterm/xterm";
import { scanPromptPreviews } from "../terminalPromptAnchors";

export interface PromptNavEntry { id: number; line: number; excerpt: string }
interface Anchor { marker: IMarker; excerpt: string }
interface Owner { term: XTerm; refresh: () => void; dispose: () => void; anchors: Anchor[] }

/** Read-only navigation over heuristic rendered markers, not conversation state. */
export function usePromptNav(termRef: React.RefObject<XTerm | null>, enabled = true) {
  const [previews, setPreviews] = useState<PromptNavEntry[]>([]);
  const ownerRef = useRef<Owner | null>(null);
  const jumpRef = useRef<(dir: "prev" | "next") => void>(() => {});

  // Ref contents can change without ref identity changing (PTY restart/restore).
  // Reconcile after every owning render, but retain subscriptions for the same instance.
  useEffect(() => {
    const term = enabled ? termRef.current : null;
    if (ownerRef.current?.term === term) return;
    ownerRef.current?.dispose();
    ownerRef.current = null;
    setPreviews((old) => old.length ? [] : old);
    if (!term) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const owner: Owner = { term, anchors: [], refresh, dispose };
    function refresh() {
      if (disposed) return;
      const found = scanPromptPreviews(term!.buffer.active);
      const remaining = new Set(owner.anchors);
      const anchors: Anchor[] = [];
      for (const entry of found) {
        let anchor = owner.anchors.find((a) => !a.marker.isDisposed && a.marker.line === entry.line && a.excerpt === entry.excerpt);
        if (anchor) remaining.delete(anchor);
        else {
          const marker = term!.registerMarker(entry.line - (term!.buffer.active.baseY + term!.buffer.active.cursorY));
          if (!marker) continue;
          anchor = { marker, excerpt: entry.excerpt };
        }
        anchors.push(anchor);
      }
      remaining.forEach((anchor) => anchor.marker.dispose());
      owner.anchors = anchors;
      const next = anchors.map(({ marker, excerpt }) => ({ id: marker.id, line: marker.line, excerpt }));
      setPreviews((old) => old.length === next.length && old.every((entry, i) => entry.id === next[i].id && entry.line === next[i].line && entry.excerpt === next[i].excerpt) ? old : next);
    }
    function schedule() {
      if (timer !== undefined || disposed) return;
      timer = setTimeout(() => { timer = undefined; refresh(); }, 80);
    }
    const subscriptions = [term.onWriteParsed(schedule), term.onResize(schedule), term.onRender(schedule), term.buffer.onBufferChange(refresh)];
    function dispose() {
      disposed = true;
      clearTimeout(timer);
      subscriptions.forEach((subscription) => subscription.dispose());
      owner.anchors.forEach((anchor) => anchor.marker.dispose());
      owner.anchors = [];
    }
    ownerRef.current = owner;
    refresh();
  });
  useEffect(() => () => { ownerRef.current?.dispose(); ownerRef.current = null; }, []);

  const jumpToPreview = (id: number) => {
    const owner = ownerRef.current;
    if (!enabled || !owner || owner.term !== termRef.current || owner.term.buffer.active.type !== "normal") return;
    // Markers move with trim/reflow; refresh also rejects in-place redraw/reset changes.
    owner.refresh();
    const anchor = owner.anchors.find((a) => a.marker.id === id && !a.marker.isDisposed);
    if (anchor) owner.term.scrollToLine(anchor.marker.line);
  };
  const jumpToPrompt = (direction: "prev" | "next") => {
    const owner = ownerRef.current;
    if (!enabled || !owner || owner.term !== termRef.current || owner.term.buffer.active.type !== "normal") return;
    owner.refresh();
    const top = owner.term.buffer.active.viewportY;
    const anchors = owner.anchors.filter((a) => !a.marker.isDisposed);
    const anchor = direction === "prev"
      ? anchors.slice().reverse().find((a) => a.marker.line < top)
      : anchors.find((a) => a.marker.line > top + owner.term.rows);
    if (anchor) owner.term.scrollToLine(anchor.marker.line);
    else if (direction === "next") owner.term.scrollToBottom();
  };
  jumpRef.current = jumpToPrompt;
  return { previews, jumpToPreview, jumpToPrompt, jumpRef, focusTerminal: () => termRef.current?.focus() };
}
