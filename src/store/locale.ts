/**
 * UI language preference — persisted the same way as `theme` (a global
 * app-settings blob, cross-vault; see `src/store/theme.ts` for the reference
 * pattern this mirrors). Defaults to the system locale, falling back to
 * English, and switches live via `i18n/index.ts`'s lazy `setLanguage`.
 */
import { create } from "zustand";
import { appSettings } from "@/services";
import { setLanguage, systemLanguage, type Language } from "@/i18n";

const SETTINGS_NAME = "locale";

interface LocaleConfig {
  language: Language;
}

interface LocaleState {
  language: Language;
  /** Change the active language, apply it live, and persist it. */
  setLanguage: (language: Language) => void;
  /** Load the persisted preference (or the system default) and apply it. */
  load: () => Promise<void>;
}

export const useLocale = create<LocaleState>((set) => ({
  language: "en",
  setLanguage: (language) => {
    set({ language });
    void setLanguage(language);
    void appSettings.write(SETTINGS_NAME, { language } satisfies LocaleConfig).catch(() => {});
  },
  load: async () => {
    const cfg = await appSettings.read<LocaleConfig>(SETTINGS_NAME).catch(() => null);
    const language = cfg?.language ?? systemLanguage();
    set({ language });
    await setLanguage(language);
  },
}));
