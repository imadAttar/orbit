import { useId, useState } from "react";
import type { PromptNavEntry } from "./hooks/usePromptNav";
import "./PromptNavigation.css";

interface Props {
  entries: PromptNavEntry[];
  previousLabel: string;
  nextLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  onSelect: (id: number) => void;
  onEscape: () => void;
  // Parent can translate these without coupling the rail to conversation state.
  label?: string;
  hint?: string;
}

/** Compact terminal-local peek. Buttons never replay input or reconstruct chat. */
export function PromptNavigation({ entries, previousLabel, nextLabel, onPrevious, onNext, onSelect, onEscape,
  label = "Rendered prompt markers", hint = "First line only · terminal buffer, not conversation history",
}: Props) {
  const [peek, setPeek] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const descriptionId = useId();
  const activePeek = peek ?? focused;
  const selected = entries.find((entry) => entry.id === activePeek);
  return (
    <nav className="prompt-peek" aria-label={label} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setPeek(null); onEscape(); }
      if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
      const index = buttons.indexOf(event.target as HTMLButtonElement);
      if (index < 0) return;
      event.preventDefault(); event.stopPropagation();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)));
      buttons[next]?.focus();
    }} onMouseLeave={() => setPeek(null)} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setPeek(null); setFocused(null); }
    }}>
      <button className="prompt-peek__step" type="button" aria-label={previousLabel} title={previousLabel} onClick={onPrevious}>⌃</button>
      <div className="prompt-peek__markers">
        {entries.map((entry, index) => (
          <button key={entry.id} className={`prompt-peek__marker${activePeek === entry.id ? " prompt-peek__marker--peek" : ""}`}
            type="button" aria-label={`${index + 1}. ${entry.excerpt}`} aria-describedby={activePeek === entry.id ? descriptionId : undefined}
            onMouseEnter={() => setPeek(entry.id)} onFocus={() => setFocused(entry.id)} onBlur={() => setFocused(null)} onClick={() => onSelect(entry.id)}>
            <span aria-hidden="true" />
          </button>
        ))}
      </div>
      <button className="prompt-peek__step" type="button" aria-label={nextLabel} title={nextLabel} onClick={onNext}>⌄</button>
      {selected && <div className="prompt-peek__preview" id={descriptionId} role="tooltip">
        <span className="prompt-peek__caption">{label}</span>
        <span className="prompt-peek__excerpt">{selected.excerpt}</span>
        <span className="prompt-peek__hint">{hint}</span>
      </div>}
    </nav>
  );
}
