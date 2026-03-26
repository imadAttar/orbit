import { useState, useCallback, useRef, useMemo } from "react";
import { useStore } from "../../core/store";
import { trackEvent } from "../../lib/analytics";
import { useT } from "../../i18n/i18n";

interface DiffLine {
  type: "add" | "del" | "ctx" | "empty";
  content: string;
  lineNum?: number;
}

/** Parse unified diff into left/right aligned lines */
function parseDiffSideBySide(diff: string): { left: DiffLine[]; right: DiffLine[] } {
  const left: DiffLine[] = [];
  const right: DiffLine[] = [];
  const lines = diff.split("\n");

  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1]) - 1;
      newLine = parseInt(hunkMatch[2]) - 1;
      inHunk = true;
      // Add separator
      left.push({ type: "ctx", content: line, lineNum: undefined });
      right.push({ type: "ctx", content: line, lineNum: undefined });
      continue;
    }

    if (!inHunk) continue;

    if (line.startsWith("-")) {
      oldLine++;
      left.push({ type: "del", content: line.slice(1), lineNum: oldLine });
      // Don't add to right yet — collect dels then adds
    } else if (line.startsWith("+")) {
      newLine++;
      right.push({ type: "add", content: line.slice(1), lineNum: newLine });
      // Don't add to left yet
    } else if (line.startsWith(" ")) {
      // Flush any unmatched dels/adds before context
      balanceLines(left, right);
      oldLine++;
      newLine++;
      left.push({ type: "ctx", content: line.slice(1), lineNum: oldLine });
      right.push({ type: "ctx", content: line.slice(1), lineNum: newLine });
    } else if (line === "\\ No newline at end of file") {
      continue;
    } else {
      // End of hunk or diff header
      inHunk = false;
    }
  }

  balanceLines(left, right);
  return { left, right };
}

/** Pad the shorter side with empty lines to keep alignment */
function balanceLines(left: DiffLine[], right: DiffLine[]) {
  // Count trailing del/add lines
  let leftDels = 0;
  for (let i = left.length - 1; i >= 0; i--) {
    if (left[i].type === "del") leftDels++;
    else break;
  }
  let rightAdds = 0;
  for (let i = right.length - 1; i >= 0; i--) {
    if (right[i].type === "add") rightAdds++;
    else break;
  }

  if (leftDels === 0 && rightAdds === 0) return;

  // Pad the shorter side
  const diff = leftDels - rightAdds;
  if (diff > 0) {
    for (let i = 0; i < diff; i++) right.push({ type: "empty", content: "" });
  } else if (diff < 0) {
    for (let i = 0; i < -diff; i++) left.push({ type: "empty", content: "" });
  }
}

function lineClass(type: DiffLine["type"]) {
  switch (type) {
    case "add": return "diff-line--add";
    case "del": return "diff-line--del";
    case "empty": return "diff-line--empty";
    default: return "";
  }
}

export default function DiffViewer() {
  const showDiffViewer = useStore((s) => s.showDiffViewer);
  const diffContent = useStore((s) => s.diffContent);
  const diffFile = useStore((s) => s.diffFile);
  const setShowDiffViewer = useStore((s) => s.setShowDiffViewer);
  const t = useT();
  const [width, setWidth] = useState(600);
  const widthStyle = useMemo(() => ({ width }), [width]);
  const dragging = useRef(false);
  const parsed = useMemo(() => {
    if (!showDiffViewer || !diffContent) return null;
    return parseDiffSideBySide(diffContent);
  }, [showDiffViewer, diffContent]);

  const widthRef = useRef(width);
  widthRef.current = width;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startW = widthRef.current;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startX - ev.clientX;
      setWidth(Math.min(1200, Math.max(400, startW + delta)));
    };
    const onUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const handleAcceptAll = useCallback(() => {
    const store = useStore.getState();
    store.setGitFiles([diffFile]);
    store.setProposedCommitMessage(`chore: accept changes to ${diffFile}`);
    store.setShowGitPanel(true);
    setShowDiffViewer(false);
    trackEvent("diff_accepted");
  }, [diffFile, setShowDiffViewer]);

  if (!showDiffViewer || !parsed) return null;

  return (
    <div className="diff-viewer" style={widthStyle}>
      <div className="diff-viewer__resize" onMouseDown={handleMouseDown} />
      <div className="diff-viewer__inner">
        <div className="diff-viewer__header">
          <span className="diff-viewer__title">{diffFile}</span>
          <div className="diff-viewer__actions">
            <button className="modal__btn--primary" onClick={handleAcceptAll}>
              {t("diff.accept")}
            </button>
            <button className="modal__btn--danger" onClick={() => { setShowDiffViewer(false); trackEvent("diff_rejected"); }}>
              {t("diff.reject")}
            </button>
            <button className="search-bar__btn" onClick={() => { setShowDiffViewer(false); trackEvent("diff_closed"); }} title={t("common.close")}>
              &#x2715;
            </button>
          </div>
        </div>
        <div className="diff-viewer__labels">
          <span className="diff-viewer__label diff-viewer__label--old">{t("diff.before")}</span>
          <span className="diff-viewer__label diff-viewer__label--new">{t("diff.after")}</span>
        </div>
        <div className="diff-viewer__content">
          <div className="diff-viewer__split">
            {/* Left side — old file */}
            <pre className="diff-viewer__pane">
              {parsed.left.map((line, i) => (
                <div key={`${line.type}-${line.lineNum ?? i}`} className={`diff-line ${lineClass(line.type)}`}>
                  <span className="diff-line__num">{line.lineNum ?? ""}</span>
                  <span className="diff-line__text">{line.content}</span>
                </div>
              ))}
            </pre>
            {/* Right side — new file */}
            <pre className="diff-viewer__pane">
              {parsed.right.map((line, i) => (
                <div key={`${line.type}-${line.lineNum ?? i}`} className={`diff-line ${lineClass(line.type)}`}>
                  <span className="diff-line__num">{line.lineNum ?? ""}</span>
                  <span className="diff-line__text">{line.content}</span>
                </div>
              ))}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
