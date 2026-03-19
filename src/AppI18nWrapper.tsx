import { useStore } from "./core/store";
import { I18nProvider } from "./i18n/i18n";

export default function AppI18nWrapper({ children }: { children: React.ReactNode }) {
  const language = useStore((s) => s.settings.language);
  return <I18nProvider language={language}>{children}</I18nProvider>;
}
