/**
 * The shell sidebar's contents while Settings is open: a search box and the
 * grouped section list, in place of the note tree — the same swap the Calendar
 * view does with its mini month.
 *
 * The rail lives out here rather than inside the view because that's where the
 * mockups put it, and because it means the settings pane is just a pane: which
 * section is open is `useViewState.settingsSection`, which both halves read.
 *
 * The search filters section *names* only. It is a way to find the page you
 * half-remember, not a search across every individual setting — matching
 * control labels would need every section's strings enumerated in a second
 * place, and they'd drift the first time one was reworded.
 */
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useViewState } from "@/store/viewState";
import { SETTINGS_GROUPS, SETTINGS_SECTIONS } from "./sections";

export function SettingsRail() {
  const { t } = useTranslation();
  const section = useViewState((s) => s.settingsSection);
  const setSection = useViewState((s) => s.setSettingsSection);
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return SETTINGS_SECTIONS;
    return SETTINGS_SECTIONS.filter((s) =>
      t(`settings.sections.${s.id}`).toLocaleLowerCase().includes(q),
    );
  }, [query, t]);

  return (
    <nav className="settings-rail" aria-label={t("settings.title")}>
      <label className="settings-rail-search">
        <Search className="h-[15px] w-[15px]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("settings.searchPlaceholder")}
          aria-label={t("settings.searchPlaceholder")}
        />
      </label>

      {SETTINGS_GROUPS.map((group) => {
        const inGroup = matches.filter((s) => s.group === group);
        if (inGroup.length === 0) return null;
        return (
          <div key={group} className="settings-rail-group">
            <h3 className="settings-rail-group-title">{t(`settings.groups.${group}`)}</h3>
            {inGroup.map((s) => (
              <button
                key={s.id}
                className={`settings-rail-item${section === s.id ? " active" : ""}`}
                aria-current={section === s.id ? "page" : undefined}
                onClick={() => setSection(s.id)}
              >
                {t(`settings.sections.${s.id}`)}
              </button>
            ))}
          </div>
        );
      })}

      {matches.length === 0 && <p className="settings-rail-empty muted">{t("settings.searchEmpty")}</p>}
    </nav>
  );
}
