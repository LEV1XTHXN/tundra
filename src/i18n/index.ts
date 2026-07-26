/**
 * i18n setup (react-i18next + i18next). UI-chrome strings only — never note
 * content (CLAUDE.md's own content is authored by the user and is never
 * translated). `en` is the source of truth and is bundled statically (zero
 * async gap, and it doubles as the `fallbackLng` resource so a lazy `ru`/`de`
 * load that hasn't resolved yet still renders readable text instead of raw
 * keys). `ru`/`de` are lazy-loaded on demand via a dynamic import, mirroring
 * the app's existing tolerance for a brief "flash of defaults" before
 * app-settings-backed stores (theme, keybindings) finish loading.
 *
 * Adding another language later is: drop `src/i18n/locales/<lang>.json`, add
 * it to `SUPPORTED_LANGUAGES` below, done — `changeLanguage` handles the rest.
 */
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";

export type Language = "en" | "ru" | "de";

export const SUPPORTED_LANGUAGES: { code: Language; label: string; nativeLabel: string }[] = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "ru", label: "Russian", nativeLabel: "Русский" },
  { code: "de", label: "German", nativeLabel: "Deutsch" },
];

const DEFAULT_LANGUAGE: Language = "en";

/** Whether a language's translations are still a machine-translation draft
 *  awaiting human review (spec: "clearly MARK non-English files as needing
 *  human review"). English is the hand-written source of truth. Flip an
 *  entry to `false` once a fluent speaker has reviewed that file. */
export const NEEDS_REVIEW: Record<Language, boolean> = {
  en: false,
  ru: true,
  de: true,
};

/** Dynamic-import loaders for every non-default language's translation JSON,
 *  one entry per supported language so Vite splits each into its own chunk. */
const LOCALE_LOADERS: Record<Exclude<Language, "en">, () => Promise<{ default: Record<string, unknown> }>> = {
  ru: () => import("./locales/ru.json"),
  de: () => import("./locales/de.json"),
};

const loadedLanguages = new Set<Language>(["en"]);

void i18next.use(initReactI18next).init({
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false }, // React already escapes.
  returnEmptyString: false,
});

/** Detect the OS/browser locale, mapped to a supported language; falls back
 *  to English for anything else (per spec: "default to the system locale,
 *  falling back to English"). */
export function systemLanguage(): Language {
  const raw = typeof navigator !== "undefined" ? navigator.language : DEFAULT_LANGUAGE;
  const base = raw?.split("-")[0]?.toLowerCase();
  const match = SUPPORTED_LANGUAGES.find((l) => l.code === base);
  return match?.code ?? DEFAULT_LANGUAGE;
}

/** Switch the active language, lazy-loading its translation JSON on first
 *  use. Safe to call repeatedly (a re-selected or already-loaded language is
 *  a cheap no-op besides the `changeLanguage` call). Live — no reload. */
export async function setLanguage(language: Language): Promise<void> {
  if (!loadedLanguages.has(language)) {
    const loader = LOCALE_LOADERS[language as Exclude<Language, "en">];
    const { default: resources } = await loader();
    i18next.addResourceBundle(language, "translation", resources);
    loadedLanguages.add(language);
  }
  await i18next.changeLanguage(language);
}

export { i18next };
