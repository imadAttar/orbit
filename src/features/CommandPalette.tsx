import { useState, useRef, useEffect, useMemo } from "react";
import { useStore } from "../core/store";
import { trackEvent } from "../lib/analytics";
import { useT } from "../i18n/i18n";
import { useBookmarkFilter } from "../hooks/useBookmarkFilter";

type BuiltinAction = {
  id: string;
  name: string;
  description: string;
  command: string;
  category: "skill";
};

interface Props {
  onClose: () => void;
  onSelectPrompt: (prompt: string) => void;
}

export default function CommandPalette({ onClose, onSelectPrompt }: Props) {
  const addBookmark = useStore((s) => s.addBookmark);
  const removeBookmark = useStore((s) => s.removeBookmark);
  const updateBookmark = useStore((s) => s.updateBookmark);
  const t = useT();
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const builtinActions = useMemo<BuiltinAction[]>(() => [
    { id: "skill-bootstrap", name: t("palette.configureProject"), description: t("palette.configureProjectDesc"), command: "/bootstrap", category: "skill" },
    { id: "skill-coach", name: t("palette.optimizeAssistant"), description: t("palette.optimizeAssistantDesc"), command: "/coach", category: "skill" },
  ], [t]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const { filtered } = useBookmarkFilter(query);
  const q = query.toLowerCase();
  const filteredActions = builtinActions.filter(
    (a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.command.toLowerCase().includes(q)
  );
  const totalItems = filteredActions.length + filtered.length;

  useEffect(() => { setSelectedIdx(0); }, [query]);

  const selectItem = (idx: number) => {
    if (idx < filtered.length) {
      const b = filtered[idx];
      onSelectPrompt(b.prompt);
      trackEvent("bookmark_used", { name: b.name });
      onClose();
    } else {
      const actionIdx = idx - filtered.length;
      if (filteredActions[actionIdx]) {
        onSelectPrompt(filteredActions[actionIdx].command);
        trackEvent("skill_executed", { skill: filteredActions[actionIdx].command });
        onClose();
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, totalItems - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && !showAdd && !editingId) { e.preventDefault(); if (totalItems > 0) selectItem(selectedIdx); }
  };

  const handleAdd = () => {
    if (newName.trim() && newPrompt.trim()) {
      addBookmark(newName.trim(), newPrompt.trim());
      trackEvent("bookmark_created");
      setNewName(""); setNewPrompt(""); setShowAdd(false);
    }
  };

  const handleUpdate = (id: string) => {
    if (editName.trim() && editPrompt.trim()) {
      updateBookmark(id, editName.trim(), editPrompt.trim());
      trackEvent("bookmark_edited");
      setEditingId(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <input
          ref={inputRef}
          className="command-palette__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("palette.search")}
        />
        <div className="command-palette__list">
          {filtered.length > 0 && (
            <div className="command-palette__section">{t("palette.projects")}</div>
          )}
          {filtered.map((b, i) => (
            <div
              key={b.id}
              className={`command-palette__item ${i === selectedIdx ? "command-palette__item--selected" : ""}`}
              onClick={() => selectItem(i)}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              {editingId === b.id ? (
                <div className="command-palette__edit" onClick={(e) => e.stopPropagation()}>
                  <input className="command-palette__edit-input" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={t("common.name")} autoFocus />
                  <input className="command-palette__edit-input" value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} placeholder={t("common.prompt")} />
                  <div className="command-palette__edit-actions">
                    <button className="modal__btn--primary" onClick={() => handleUpdate(b.id)}>OK</button>
                    <button className="modal__btn--secondary" onClick={() => setEditingId(null)}>{t("common.cancel")}</button>
                  </div>
                </div>
              ) : (
                <>
                  <span className="command-palette__name">
                    <span className="command-palette__badge command-palette__badge--project">/{b.name.toLowerCase().replace(/\s+/g, "-")}</span>
                    {b.name}
                  </span>
                  <span className="command-palette__prompt">{b.prompt}</span>
                  <div className="command-palette__actions">
                    <button className="command-palette__action-btn" onClick={(e) => { e.stopPropagation(); setEditingId(b.id); setEditName(b.name); setEditPrompt(b.prompt); }} title={t("common.modify")}>
                      &#x270E;
                    </button>
                    <button className="command-palette__action-btn command-palette__action-btn--danger" onClick={(e) => { e.stopPropagation(); removeBookmark(b.id); trackEvent("bookmark_deleted"); }} title={t("common.delete")}>
                      &times;
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {filteredActions.length > 0 && (
            <>
              <div className="command-palette__section">{t("palette.skills")}</div>
              {filteredActions.map((a, i) => {
                const idx = filtered.length + i;
                return (
                  <div
                    key={a.id}
                    className={`command-palette__item ${idx === selectedIdx ? "command-palette__item--selected" : ""}`}
                    onClick={() => selectItem(idx)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  >
                    <span className="command-palette__name">
                      <span className="command-palette__badge">/{a.command.slice(1)}</span>
                      {a.name}
                    </span>
                    <span className="command-palette__prompt">{a.description}</span>
                  </div>
                );
              })}
            </>
          )}
          {totalItems === 0 && !showAdd && (
            <div className="command-palette__empty">
              {t("palette.noResults")}
              <button className="command-palette__add-btn" onClick={() => setShowAdd(true)}>
                {t("palette.addBookmark")}
              </button>
            </div>
          )}
        </div>
        {showAdd ? (
          <div className="command-palette__add-form">
            <input className="command-palette__edit-input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("palette.bookmarkName")} autoFocus />
            <textarea className="command-palette__edit-textarea" value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} placeholder={t("palette.bookmarkPrompt")} rows={3} />
            <div className="command-palette__edit-actions">
              <button className="modal__btn--primary" onClick={handleAdd} disabled={!newName.trim() || !newPrompt.trim()}>{t("palette.add")}</button>
              <button className="modal__btn--secondary" onClick={() => setShowAdd(false)}>{t("common.cancel")}</button>
            </div>
          </div>
        ) : (
          <button className="command-palette__footer-btn" onClick={() => setShowAdd(true)}>
            {t("palette.newBookmark")}
          </button>
        )}
      </div>
    </div>
  );
}
