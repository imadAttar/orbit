import { useRef, useCallback, useMemo } from "react";
import { useStore } from "../../core/store";
import TerminalView from "./Terminal";

interface Props {
  primarySid: string;
  secondarySid: string;
  projectDir: string;
  ratio: number;
  searchOpen: boolean;
  onSearchClose: () => void;
}

export default function SplitPane({
  primarySid,
  secondarySid,
  projectDir,
  ratio,
  searchOpen,
  onSearchClose,
}: Props) {
  const focusedPane = useStore((s) => s.focusedPane);
  const setFocusedPane = useStore((s) => s.setFocusedPane);
  const setSplitRatio = useStore((s) => s.setSplitRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const focusPrimary = useCallback(() => setFocusedPane("primary"), [setFocusedPane]);
  const focusSecondary = useCallback(() => setFocusedPane("secondary"), [setFocusedPane]);
  const primaryStyle = useMemo(() => ({ width: `${ratio * 100}%` }), [ratio]);
  const secondaryStyle = useMemo(() => ({ width: `${(1 - ratio) * 100}%` }), [ratio]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      let rafId = 0;

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current || !containerRef.current) return;
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          if (!containerRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          const newRatio = Math.min(0.8, Math.max(0.2, (ev.clientX - rect.left) / rect.width));
          setSplitRatio(newRatio);
        });
      };

      const onUp = () => {
        dragging.current = false;
        cancelAnimationFrame(rafId);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [setSplitRatio]
  );

  return (
    <div ref={containerRef} className="split-pane">
      <div
        className={`split-pane__panel ${focusedPane === "primary" ? "split-pane__panel--focused" : ""}`}
        style={primaryStyle}
        onClick={focusPrimary}
      >
        <TerminalView
          sessionId={primarySid}
          projectDir={projectDir}
          active={focusedPane === "primary"}
          visible={true}
          searchOpen={focusedPane === "primary" && searchOpen}
          onSearchClose={onSearchClose}
        />
      </div>
      <div className="split-divider" onMouseDown={handleMouseDown} />
      <div
        className={`split-pane__panel ${focusedPane === "secondary" ? "split-pane__panel--focused" : ""}`}
        style={secondaryStyle}
        onClick={focusSecondary}
      >
        <TerminalView
          sessionId={secondarySid}
          projectDir={projectDir}
          active={focusedPane === "secondary"}
          visible={true}
          searchOpen={focusedPane === "secondary" && searchOpen}
          onSearchClose={onSearchClose}
        />
      </div>
    </div>
  );
}
