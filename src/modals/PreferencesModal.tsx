import { useReducer, useEffect } from "react";
import type { TerminalPref, ThemeName, Language, SessionMode } from "../core/types";
import { useStore } from "../core/store";
import { THEMES, applyChrome } from "../lib/themes";
import { trackEvent, setAnalyticsEnabled } from "../lib/analytics";
import { useT } from "../i18n/i18n";
import { modLabel, modSymbol, terminalOptions } from "../lib/platform";
import FocusTrap from "../shared/FocusTrap";

interface PrefsState {
  terminal: TerminalPref;
  theme: ThemeName;
  fontSize: number;
  analytics: boolean;
  autoUpdate: boolean;
  language: Language;
  defaultMode: SessionMode;
  tab: "general" | "shortcuts";
}

type PrefsAction =
  | { type: "set"; field: keyof Omit<PrefsState, "tab">; value: string | number | boolean }
  | { type: "setTab"; value: "general" | "shortcuts" };

function prefsReducer(state: PrefsState, action: PrefsAction): PrefsState {
  switch (action.type) {
    case "set": return { ...state, [action.field]: action.value };
    case "setTab": return { ...state, tab: action.value };
    default: return state;
  }
}

export default function PreferencesModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const setTerminal = useStore((s) => s.setTerminal);
  const setTheme = useStore((s) => s.setTheme);
  const setFontSize = useStore((s) => s.setFontSize);
  const setAnalytics = useStore((s) => s.setAnalytics);
  const setAutoUpdate = useStore((s) => s.setAutoUpdate);
  const setLanguage = useStore((s) => s.setLanguage);
  const setDefaultMode = useStore((s) => s.setDefaultMode);

  const [prefs, dispatch] = useReducer(prefsReducer, {
    terminal: settings.terminal,
    theme: settings.theme,
    fontSize: settings.fontSize,
    analytics: settings.analytics,
    autoUpdate: settings.autoUpdate,
    language: settings.language,
    defaultMode: settings.defaultMode,
    tab: "general",
  });

  useEffect(() => {
    const th = THEMES[prefs.theme];
    if (th) applyChrome(th);
  }, [prefs.theme]);

  const handleSave = () => {
    setTerminal(prefs.terminal);
    setTheme(prefs.theme);
    setFontSize(prefs.fontSize);
    setAnalytics(prefs.analytics);
    setAutoUpdate(prefs.autoUpdate);
    setLanguage(prefs.language);
    setDefaultMode(prefs.defaultMode);
    setAnalyticsEnabled(prefs.analytics);
    if (prefs.theme !== settings.theme) trackEvent("theme_changed", { from: settings.theme, to: prefs.theme });
    if (prefs.fontSize !== settings.fontSize) trackEvent("font_size_changed", { from: settings.fontSize, to: prefs.fontSize });
    if (prefs.language !== settings.language) trackEvent("language_changed", { from: settings.language, to: prefs.language });
    if (prefs.defaultMode !== settings.defaultMode) trackEvent("default_mode_changed", { from: settings.defaultMode, to: prefs.defaultMode });
    trackEvent("preferences_saved", { theme: prefs.theme, fontSize: prefs.fontSize, terminal: prefs.terminal, language: prefs.language, editor: useStore.getState().settings.editor, defaultMode: prefs.defaultMode });
    onClose();
  };

  const handleCancel = () => {
    const th = THEMES[settings.theme];
    if (th) applyChrome(th);
    onClose();
  };

  return (
    <div className="modal-overlay" role="presentation" onClick={handleCancel} onKeyDown={(e) => { if (e.key === "Escape") handleCancel(); }}>
      <div className="modal modal--wide" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <FocusTrap>
        <div className="modal__title">{t("prefs.title")}</div>
        <div className="prefs-tabs">
          <button
            className={`prefs-tabs__tab ${prefs.tab === "general" ? "prefs-tabs__tab--active" : ""}`}
            onClick={() => dispatch({ type: "setTab", value: "general" })}
          >{t("prefs.general")}</button>
          <button
            className={`prefs-tabs__tab ${prefs.tab === "shortcuts" ? "prefs-tabs__tab--active" : ""}`}
            onClick={() => dispatch({ type: "setTab", value: "shortcuts" })}
          >{t("prefs.shortcuts")}</button>
        </div>

        {prefs.tab === "general" && (
          <>
            <label className="modal__label">
              {t("prefs.theme")}
              <select className="modal__select" value={prefs.theme} onChange={(e) => dispatch({ type: "set", field: "theme", value: e.target.value })}>
                {(Object.keys(THEMES) as ThemeName[]).map((key) => (
                  <option key={key} value={key}>{THEMES[key].label}</option>
                ))}
              </select>
            </label>
            <label className="modal__label">
              {t("prefs.defaultMode")}
              <select className="modal__select" value={prefs.defaultMode} onChange={(e) => dispatch({ type: "set", field: "defaultMode", value: e.target.value })}>
                <option value="normal">{t("prefs.modeNormal")}</option>
                <option value="yolo">{t("prefs.modeYolo")}</option>
              </select>
            </label>
            <div className="modal__hint">{t("prefs.defaultModeHint")}</div>
            <label className="modal__label">
              {t("prefs.fontSize")}
              <div className="modal__font-size-row">
                <input type="range" min={8} max={20} value={prefs.fontSize} onChange={(e) => dispatch({ type: "set", field: "fontSize", value: Number(e.target.value) })} className="modal__range" />
                <span className="modal__font-size-value">{prefs.fontSize}px</span>
              </div>
            </label>
            <label className="modal__label">
              {t("prefs.externalTerminal")}
              <select className="modal__select" value={prefs.terminal} onChange={(e) => dispatch({ type: "set", field: "terminal", value: e.target.value })}>
                {terminalOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <div className="modal__hint">{t("prefs.externalTerminalHint", { shortcut: `${modSymbol}T` })}</div>
            <label className="modal__label modal__toggle-row">
              <span>{t("prefs.analytics")}</span>
              <input type="checkbox" checked={prefs.analytics} onChange={(e) => dispatch({ type: "set", field: "analytics", value: e.target.checked })} className="modal__checkbox" />
            </label>
            <div className="modal__hint">{t("prefs.analyticsHint")}</div>
            <label className="modal__label modal__toggle-row">
              <span>{t("prefs.autoUpdate")}</span>
              <input type="checkbox" checked={prefs.autoUpdate} onChange={(e) => dispatch({ type: "set", field: "autoUpdate", value: e.target.checked })} className="modal__checkbox" />
            </label>
            <div className="modal__hint">{t("prefs.autoUpdateHint")}</div>
            <label className="modal__label">
              {t("prefs.language")}
              <select className="modal__select" value={prefs.language} onChange={(e) => dispatch({ type: "set", field: "language", value: e.target.value })}>
                <option value="fr">Francais</option>
                <option value="en">English</option>
              </select>
            </label>
            <div className="modal__actions">
              <button className="modal__btn--secondary" onClick={handleCancel}>{t("common.cancel")}</button>
              <button className="modal__btn--primary" onClick={handleSave}>{t("common.save")}</button>
            </div>
          </>
        )}

        {prefs.tab === "shortcuts" && (
          <div className="shortcuts-grid">
            <div className="shortcuts-grid__section">{t("shortcuts.sessions")}</div>
            <div className="shortcuts-grid__row"><kbd>{modLabel}</kbd><kbd>N</kbd><span>{t("shortcuts.newSession")}</span></div>
            <div className="shortcuts-grid__row"><kbd>{modLabel}</kbd><kbd>W</kbd><span>{t("shortcuts.closeSession")}</span></div>
            <div className="shortcuts-grid__row"><kbd>Ctrl</kbd><kbd>Tab</kbd><span>{t("shortcuts.nextSession")}</span></div>
            <div className="shortcuts-grid__row"><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>Tab</kbd><span>{t("shortcuts.prevSession")}</span></div>
            <div className="shortcuts-grid__row"><kbd>Ctrl</kbd><kbd>1-9</kbd><span>{t("shortcuts.goToSession")}</span></div>
            <div className="shortcuts-grid__section">{t("shortcuts.navigation")}</div>
            <div className="shortcuts-grid__row"><kbd>{modLabel}</kbd><kbd>F</kbd><span>{t("shortcuts.searchTerminal")}</span></div>
            <div className="shortcuts-grid__row"><kbd>{modLabel}</kbd><kbd>P</kbd><span>{t("shortcuts.bookmarks")}</span></div>
            <div className="shortcuts-grid__row"><kbd>{modLabel}</kbd><kbd>,</kbd><span>{t("shortcuts.preferences")}</span></div>
            <div className="shortcuts-grid__section">{t("shortcuts.split")}</div>
            <div className="shortcuts-grid__row"><kbd>{modLabel}</kbd><kbd>\</kbd><span>{t("shortcuts.splitToggle")}</span></div>
            <div className="shortcuts-grid__row"><kbd>{modLabel}</kbd><kbd>]</kbd><span>{t("shortcuts.focusNext")}</span></div>
            <div className="shortcuts-grid__row"><kbd>{modLabel}</kbd><kbd>[</kbd><span>{t("shortcuts.focusPrev")}</span></div>
            <div className="shortcuts-grid__section">{t("shortcuts.misc")}</div>
            <div className="shortcuts-grid__row"><kbd>{modLabel}</kbd><kbd>+</kbd><span>{t("shortcuts.zoomIn")}</span></div>
            <div className="shortcuts-grid__row"><kbd>{modLabel}</kbd><kbd>-</kbd><span>{t("shortcuts.zoomOut")}</span></div>
            <div className="shortcuts-grid__row"><kbd>{modLabel}</kbd><kbd>T</kbd><span>{t("shortcuts.externalTerminal")}</span></div>
            <div className="shortcuts-grid__row"><kbd>{modLabel}</kbd><kbd>Shift</kbd><kbd>N</kbd><span>{t("shortcuts.newProject")}</span></div>
            <div className="modal__actions modal__actions--spaced">
              <button className="modal__btn--secondary" onClick={onClose}>{t("common.close")}</button>
            </div>
          </div>
        )}
        </FocusTrap>
      </div>
    </div>
  );
}
