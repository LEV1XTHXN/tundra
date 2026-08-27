/**
 * The settings section list — the one place that knows what exists and in what
 * order. `SettingsRail` renders it, `SettingsView` switches on it, and
 * `useViewState.settingsSection` names the open one.
 *
 * Separate from both so neither has to import the other: the rail lives in the
 * shell sidebar, the pane in the main pane, and they only agree through this
 * list and the store.
 */

/** Section ids, in rail order. */
export const SETTINGS_SECTIONS = [
  { id: "appearance", group: "lookAndFeel" },
  { id: "editor", group: "lookAndFeel" },
  { id: "language", group: "lookAndFeel" },
  { id: "keybindings", group: "workspace" },
  { id: "dictionaries", group: "workspace" },
  { id: "vault", group: "workspace" },
  { id: "import", group: "data" },
  { id: "backup", group: "data" },
  { id: "maintenance", group: "data" },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export type SettingsSectionId = SettingsSection["id"];
export type SettingsGroupId = SettingsSection["group"];

/** Groups in rail order. Derived from the sections rather than listed twice, so
 *  a section can never name a group the rail doesn't render. */
export const SETTINGS_GROUPS: SettingsGroupId[] = [
  ...new Set(SETTINGS_SECTIONS.map((s) => s.group)),
];
