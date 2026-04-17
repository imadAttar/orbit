import { createContext, useContext, useMemo } from "react";
import fr from "./fr.json";
import en from "./en.json";

type Language = "fr" | "en";
type TranslationKey = keyof typeof fr;

const translations: Record<Language, Record<string, string>> = { fr, en };

type TFunction = (key: TranslationKey, params?: Record<string, string | number>) => string;

const I18nContext = createContext<{ t: TFunction; language: Language }>({
  t: (key) => key,
  language: "en",
});

export function detectSystemLanguage(): Language {
  try {
    const lang = navigator.language || "";
    return lang.startsWith("fr") ? "fr" : "en";
  } catch {
    return "en";
  }
}

function createT(language: Language): TFunction {
  const dict = translations[language] ?? translations.en;
  return (key, params) => {
    let str = dict[key] ?? translations.en[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return str;
  };
}

export function I18nProvider({ language, children }: { language: Language; children: React.ReactNode }) {
  const value = useMemo(() => ({
    t: createT(language),
    language,
  }), [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): TFunction {
  return useContext(I18nContext).t;
}

