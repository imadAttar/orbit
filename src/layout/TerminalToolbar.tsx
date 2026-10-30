import { useStore } from "../core/store";
import { useT } from "../i18n/i18n";
import "./terminal-toolbar.css";

/** Display-only controls: never inject commands or touch Claude's terminal output. */
export default function TerminalToolbar({ onSearch, searchOpen }: { onSearch: () => void; searchOpen: boolean }) {
  const t = useT();
  const size = useStore(s => s.settings.fontSize);
  const setFontSize = useStore(s => s.setFontSize);
  return (
    <div className="terminal-tools" role="group" aria-label={t("shortcuts.navigation")}>
      <button className="terminal-tools__button" type="button" title={t("shortcuts.searchTerminal")}
        aria-label={t("shortcuts.searchTerminal")} aria-pressed={searchOpen} onClick={onSearch}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" />
        </svg>
      </button>
      <div className="terminal-tools__zoom">
        <button className="terminal-tools__button" type="button" title={t("shortcuts.zoomOut")} aria-label={t("shortcuts.zoomOut")}
          disabled={size <= 8} onClick={() => setFontSize(Math.max(8, size - 1))}>A−</button>
        <span className="terminal-tools__size">{size}px</span>
        <button className="terminal-tools__button" type="button" title={t("shortcuts.zoomIn")} aria-label={t("shortcuts.zoomIn")}
          disabled={size >= 20} onClick={() => setFontSize(Math.min(20, size + 1))}>A+</button>
      </div>
    </div>
  );
}
