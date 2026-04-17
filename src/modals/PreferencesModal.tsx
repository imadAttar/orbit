import { useReducer, useEffect } from "react";
import type { ThemeName, Language, SessionMode } from "../core/types";
import { useStore } from "../core/store";
import { THEMES, applyChrome } from "../lib/themes";
import { trackEvent, setAnalyticsEnabled } from "../lib/analytics";
import { useT } from "../i18n/i18n";
import { modLabel } from "../lib/platform";
import FocusTrap from "../shared/FocusTrap";

type Tab = "appearance" | "session" | "privacy" | "shortcuts";

interface PrefsState {
  theme: ThemeName;
  fontSize: number;
  analytics: boolean;
  autoUpdate: boolean;
  autoNotifications: boolean;
  language: Language;
  defaultMode: SessionMode;
  tab: Tab;
}

type PrefsAction =
  | { type: "set"; field: keyof Omit<PrefsState, "tab">; value: string | number | boolean }
  | { type: "setTab"; value: Tab };

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
  const updateSettings = useStore((s) => s.updateSettings);

  const [prefs, dispatch] = useReducer(prefsReducer, {
    theme: settings.theme,
    fontSize: settings.fontSize,
    analytics: settings.analytics,
    autoUpdate: settings.autoUpdate,
    autoNotifications: settings.autoNotifications,
    language: settings.language,
    defaultMode: settings.defaultMode,
    tab: "appearance",
  });

  useEffect(() => {
    const th = THEMES[prefs.theme];
    if (th) applyChrome(th);
  }, [prefs.theme]);

  const handleSave = () => {
    updateSettings({
      theme: prefs.theme,
      fontSize: Math.max(8, Math.min(20, prefs.fontSize)),
      analytics: prefs.analytics,
      autoUpdate: prefs.autoUpdate,
      autoNotifications: prefs.autoNotifications,
      language: prefs.language,
      defaultMode: prefs.defaultMode,
    });
    setAnalyticsEnabled(prefs.analytics);
    if (prefs.theme !== settings.theme) trackEvent("theme_changed", { from: settings.theme, to: prefs.theme });
    if (prefs.fontSize !== settings.fontSize) trackEvent("font_size_changed", { from: settings.fontSize, to: prefs.fontSize });
    if (prefs.language !== settings.language) trackEvent("language_changed", { from: settings.language, to: prefs.language });
    if (prefs.defaultMode !== settings.defaultMode) trackEvent("default_mode_changed", { from: settings.defaultMode, to: prefs.defaultMode });
    if (prefs.autoNotifications !== settings.autoNotifications) trackEvent("auto_notifications_changed", { enabled: prefs.autoNotifications ? 1 : 0 });
    trackEvent("preferences_saved", { theme: prefs.theme, fontSize: prefs.fontSize, language: prefs.language, defaultMode: prefs.defaultMode });
    onClose();
  };

  const handleCancel = () => {
    const th = THEMES[settings.theme];
    if (th) applyChrome(th);
    onClose();
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "appearance", label: t("prefs.sectionAppearance") },
    { id: "session", label: t("prefs.sectionSession") },
    { id: "privacy", label: t("prefs.sectionPrivacy") },
    { id: "shortcuts", label: t("prefs.shortcuts") },
  ];

  return (
    <div className="modal-overlay" role="presentation" onClick={handleCancel} onKeyDown={(e) => { if (e.key === "Escape") handleCancel(); }}>
      <div className="prefs" role="dialog" aria-modal="true" data-testid="preferences-modal" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <FocusTrap>
        <nav className="prefs__nav">
          <div className="prefs__nav-title">{t("prefs.title")}</div>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              data-testid={`prefs-tab-${tab.id}`}
              className={`prefs__nav-item ${prefs.tab === tab.id ? "prefs__nav-item--active" : ""}`}
              onClick={() => dispatch({ type: "setTab", value: tab.id })}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="prefs__content">
          {prefs.tab === "appearance" && (
            <div className="prefs__panel">
              <label className="modal__label">
                {t("prefs.theme")}
                <select data-testid="theme-select" className="modal__select" value={prefs.theme} onChange={(e) => dispatch({ type: "set", field: "theme", value: e.target.value })}>
                  {(Object.keys(THEMES) as ThemeName[]).map((key) => (
                    <option key={key} value={key}>{THEMES[key].label}</option>
                  ))}
                </select>
              </label>
              <label className="modal__label">
                {t("prefs.fontSize")}
                <div className="modal__font-size-row">
                  <input type="range" min={8} max={20} value={prefs.fontSize} onChange={(e) => dispatch({ type: "set", field: "fontSize", value: Number(e.target.value) })} className="modal__range" />
                  <span className="modal__font-size-value">{prefs.fontSize}px</span>
                </div>
              </label>
              <label className="modal__label">
                {t("prefs.language")}
                <select className="modal__select" value={prefs.language} onChange={(e) => dispatch({ type: "set", field: "language", value: e.target.value })}>
                  <option value="fr">Francais</option>
                  <option value="en">English</option>
                </select>
              </label>
            </div>
          )}

          {prefs.tab === "session" && (
            <div className="prefs__panel">
              <label className="modal__label">
                {t("prefs.defaultMode")}
                <select className="modal__select" value={prefs.defaultMode} onChange={(e) => dispatch({ type: "set", field: "defaultMode", value: e.target.value })}>
                  <option value="normal">{t("prefs.modeNormal")}</option>
                  <option value="yolo">{t("prefs.modeYolo")}</option>
                </select>
                <div className="modal__hint">{t("prefs.defaultModeHint")}</div>
              </label>
              <label className="modal__label modal__toggle-row">
                <div>
                  <span>{t("prefs.autoNotifications")}</span>
                  <div className="modal__hint">{t("prefs.autoNotificationsHint")}</div>
                </div>
                <input type="checkbox" checked={prefs.autoNotifications} onChange={(e) => dispatch({ type: "set", field: "autoNotifications", value: e.target.checked })} className="modal__checkbox" />
              </label>
            </div>
          )}

          {prefs.tab === "privacy" && (
            <div className="prefs__panel">
              <label className="modal__label modal__toggle-row">
                <div>
                  <span>{t("prefs.analytics")}</span>
                  <div className="modal__hint">{t("prefs.analyticsHint")}</div>
                </div>
                <input type="checkbox" checked={prefs.analytics} onChange={(e) => dispatch({ type: "set", field: "analytics", value: e.target.checked })} className="modal__checkbox" />
              </label>
              <label className="modal__label modal__toggle-row">
                <div>
                  <span>{t("prefs.autoUpdate")}</span>
                  <div className="modal__hint">{t("prefs.autoUpdateHint")}</div>
                </div>
                <input type="checkbox" checked={prefs.autoUpdate} onChange={(e) => dispatch({ type: "set", field: "autoUpdate", value: e.target.checked })} className="modal__checkbox" />
              </label>
            </div>
          )}

          {prefs.tab === "shortcuts" && (
            <div className="prefs__panel shortcuts-grid">
              <div className="shortcuts-grid__section">{t("shortcuts.sessions")}</div>
              <div className="shortcuts-grid__row"><kbd>{modLabel}</kbd><kbd>N</kbd><span>{t("shortcuts.newSession")}</span></div>
              <div className="shortcuts-grid__row"><kbd>{modLabel}</kbd><kbd>W</kbd><span>{t("shortcuts.closeSession")}</span></div>
              <div className="shortcuts-grid__row"><kbd>Ctrl</kbd><kbd>Tab</kbd><span>{t("shortcuts.nextSession")}</span></div>
              <div className="shortcuts-grid__row"><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>Tab</kbd><span>{t("shortcuts.prevSession")}</span></div>
              <div className="shortcuts-grid__row"><kbd>Ctrl</kbd><kbd>1-9</kbd><span>{t("shortcuts.goToSession")}</span></div>
              <div className="shortcuts-grid__section">{t("shortcuts.navigation")}</div>
              <div className="shortcuts-grid__row"><kbd>{modLabel}</kbd><kbd>F</kbd><span>{t("shortcuts.searchTerminal")}</span></div>
              <div className="shortcuts-grid__row"><kbd>{modLabel}</kbd><kbd>,</kbd><span>{t("shortcuts.preferences")}</span></div>
              <div className="shortcuts-grid__section">{t("shortcuts.misc")}</div>
              <div className="shortcuts-grid__row"><kbd>{modLabel}</kbd><kbd>+</kbd><span>{t("shortcuts.zoomIn")}</span></div>
              <div className="shortcuts-grid__row"><kbd>{modLabel}</kbd><kbd>-</kbd><span>{t("shortcuts.zoomOut")}</span></div>
              <div className="shortcuts-grid__row"><kbd>{modLabel}</kbd><kbd>Shift</kbd><kbd>N</kbd><span>{t("shortcuts.newProject")}</span></div>
            </div>
          )}

          {prefs.tab !== "shortcuts" && (
            <div className="prefs__footer">
              <button className="modal__btn--secondary" onClick={handleCancel}>{t("common.cancel")}</button>
              <button data-testid="prefs-save" className="modal__btn--primary" onClick={handleSave}>{t("common.save")}</button>
            </div>
          )}
        </div>
        </FocusTrap>
      </div>
    </div>
  );
}
