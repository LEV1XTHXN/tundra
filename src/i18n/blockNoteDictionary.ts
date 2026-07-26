/**
 * BlockNote's own menu/placeholder strings (slash menu, toolbar, drag handle,
 * etc.) are localized separately from our i18next strings, via BlockNote's
 * built-in `dictionary` option. `@blocknote/core/locales` only ships as ONE
 * bundle covering every language it supports (no per-language subpath in the
 * published package — confirmed against its `exports` map), so true
 * per-language code-splitting isn't available here; the pragmatic
 * lazy-loading move is deferring the import until an editor actually mounts,
 * rather than paying for it at app boot.
 */
import { useEffect, useState } from "react";
import type { Dictionary } from "@blocknote/core";
import { useLocale } from "@/store/locale";
import type { Language } from "@/i18n";

let cached: Record<string, Dictionary> | null = null;
let loading: Promise<Record<string, Dictionary>> | null = null;

function loadDictionaries(): Promise<Record<string, Dictionary>> {
  if (cached) return Promise.resolve(cached);
  if (!loading) {
    loading = import("@blocknote/core/locales").then((mod) => {
      cached = mod as unknown as Record<string, Dictionary>;
      return cached;
    });
  }
  return loading;
}

/** The BlockNote dictionary matching the active UI language, or `undefined`
 *  until it finishes loading (BlockNote falls back to its own English
 *  default while `undefined`, same tolerance as the rest of the app's
 *  app-settings-backed preferences). */
export function useBlockNoteDictionary(): Dictionary | undefined {
  const language = useLocale((s) => s.language);
  const [dictionary, setDictionary] = useState<Dictionary | undefined>(cached?.[language]);

  useEffect(() => {
    let cancelled = false;
    void loadDictionaries().then((dictionaries) => {
      if (!cancelled) setDictionary(dictionaries[language as Language] ?? dictionaries.en);
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  return dictionary;
}
