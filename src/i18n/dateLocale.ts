/**
 * Lazily loads the date-fns `Locale` matching the active UI language, so a
 * user who never switches away from English never pays for the `ru`/`de`
 * locale data (see CLAUDE.md's lazy-load requirement). Each language's
 * locale is its own small module (`date-fns/locale/<code>`), fetched once and
 * cached in memory for the rest of the session.
 */
import { useEffect, useState } from "react";
import type { Locale } from "date-fns";
import { useLocale } from "@/store/locale";
import type { Language } from "@/i18n";

const LOADERS: Record<Language, () => Promise<Locale>> = {
  en: () => import("date-fns/locale/en-US").then((m) => m.enUS),
  ru: () => import("date-fns/locale/ru").then((m) => m.ru),
  de: () => import("date-fns/locale/de").then((m) => m.de),
};

const cache = new Map<Language, Locale>();

/** The date-fns locale for the active UI language; `undefined` until it
 *  finishes loading (date-fns formatting functions treat that as their
 *  own English default, so callers can pass it straight through). */
export function useDateLocale(): Locale | undefined {
  const language = useLocale((s) => s.language);
  const [locale, setLocale] = useState<Locale | undefined>(cache.get(language));

  useEffect(() => {
    const cached = cache.get(language);
    if (cached) {
      setLocale(cached);
      return;
    }
    let cancelled = false;
    void LOADERS[language]().then((loaded) => {
      cache.set(language, loaded);
      if (!cancelled) setLocale(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  return locale;
}
