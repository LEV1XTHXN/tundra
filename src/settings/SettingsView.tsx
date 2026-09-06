/**
 * The settings surface (CLAUDE.md §6.2 `settings`) — a top-level view like any
 * other, not a dialog. Preferences are owned by their stores (persisted via
 * Rust); React only renders and captures input.
 *
 * The section list is a rail in the shell sidebar's slot (`SettingsRail.tsx`),
 * the same swap the Calendar view does with its mini month; which section is
 * open lives in `useViewState` so the two halves agree. This file is the pane:
 * one section component per entry in `SETTINGS_SECTIONS`.
 *
 * Tags and Templates are deliberately NOT here — each is a top-level view of its
 * own, reached from the shell's icon ribbon.
 */
import { useCallback, useEffect, useState } from "react";
import { FolderOpen, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ViewFrame } from "@/components/ViewFrame";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COMMANDS, type CommandId } from "@/keybindings/registry";
import { eventToBinding, formatBinding } from "@/keybindings/binding";
import { findConflicts, useKeybindings } from "@/store/keybindings";
import { EDITOR_FONT_SIZE_MAX, EDITOR_FONT_SIZE_MIN, useTheme, type ThemePref, type TimeFormatPref } from "@/store/theme";
import { useLocale } from "@/store/locale";
import { useViewState } from "@/store/viewState";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "./sections";
import { SUPPORTED_LANGUAGES, NEEDS_REVIEW } from "@/i18n";
import { localizeError } from "@/i18n/errors";
import { appSettings, attachments, backup, notes, pickDirectory, spellcheck, vault } from "@/services";
import type { CleanupReport, SpellLanguages, VaultInfo } from "@/services";

interface SettingsViewProps {
  vaultInfo: VaultInfo;
  /** Called after a vault cleanup with the ids that were deleted, so the app can
   *  refresh the note tree and close the open note if it was one of them. */
  onCleaned?: (deletedIds: string[]) => void;
  /** Open the import flow for the given source app — a dialog, because it needs
   *  the full window and a wizard's worth of steps. */
  onOpenImport?: (source: "obsidian" | "notion" | "anytype") => void;
}

/** The pane for one section. Keeps the switch in one place, next to the section
 *  list it has to stay in step with. */
function SectionPane({
  section,
  vaultInfo,
  onCleaned,
  onOpenImport,
}: SettingsViewProps & { section: SettingsSectionId }) {
  switch (section) {
    case "appearance":
      return <AppearanceSection />;
    case "editor":
      return <EditorSection />;
    case "language":
      return <LanguageSection />;
    case "keybindings":
      return <KeybindingsSection />;
    case "dictionaries":
      return <DictionariesSection />;
    case "vault":
      return <VaultSection vaultInfo={vaultInfo} />;
    case "import":
      return <ImportSection onOpenImport={onOpenImport} />;
    case "backup":
      return <BackupSection />;
    case "maintenance":
      return <MaintenanceSection onCleaned={onCleaned} />;
  }
}

export function SettingsView({ vaultInfo, onCleaned, onOpenImport }: SettingsViewProps) {
  const { t } = useTranslation();
  const section = useViewState((s) => s.settingsSection);
  const meta = SETTINGS_SECTIONS.find((s) => s.id === section) ?? SETTINGS_SECTIONS[0];

  return (
    <ViewFrame title={t("settings.title")}>
      <div className="settings-pane">
        <h2 className="settings-pane-title">{t(`settings.sections.${meta.id}`)}</h2>
        <p className="settings-pane-desc muted">{t(`settings.sectionDescriptions.${meta.id}`)}</p>
        <SectionPane
          section={meta.id}
          vaultInfo={vaultInfo}
          onCleaned={onCleaned}
          onOpenImport={onOpenImport}
        />
      </div>
    </ViewFrame>
  );
}

/** Appearance: the theme, the clock, and the two small comfort toggles. What
 *  the app LOOKS like — the editor's own type settings are their own section,
 *  and the interface language a third, because those are three different
 *  questions that used to share one very long page. */
function AppearanceSection() {
  const { t } = useTranslation();
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);
  const timeFormat = useTheme((s) => s.timeFormat);
  const setTimeFormat = useTheme((s) => s.setTimeFormat);
  const showModifiedOnHover = useTheme((s) => s.showModifiedOnHover);
  const setShowModifiedOnHover = useTheme((s) => s.setShowModifiedOnHover);
  const options: { id: ThemePref; label: string; desc: string }[] = [
    { id: "system", label: t("settings.appearance.themeSystem"), desc: t("settings.appearance.themeSystemDesc") },
    { id: "light", label: t("settings.appearance.themeLight"), desc: t("settings.appearance.themeLightDesc") },
    { id: "dark", label: t("settings.appearance.themeDark"), desc: t("settings.appearance.themeDarkDesc") },
  ];
  const timeOptions: { id: TimeFormatPref; label: string; desc: string }[] = [
    { id: "24h", label: t("settings.appearance.clock24h"), desc: "13:00" },
    { id: "12h", label: t("settings.appearance.clock12h"), desc: "1:00 PM" },
  ];
  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t("settings.appearance.title")}</h3>
      <p className="muted settings-section-desc">{t("settings.appearance.themeDesc")}</p>
      <div className="settings-theme-options" role="radiogroup" aria-label="Theme">
        {options.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={theme === o.id}
            className={`settings-theme-option${theme === o.id ? " active" : ""}`}
            onClick={() => setTheme(o.id)}
          >
            {/* A miniature of the app: a chrome rail beside a page of text. It
                paints the target theme's own colours literally, because the
                point is to show a theme you are NOT currently in. */}
            <span className={`settings-theme-preview settings-theme-preview-${o.id}`} aria-hidden="true">
              <span className="settings-theme-preview-rail" />
              <span className="settings-theme-preview-page">
                <span className="settings-theme-preview-line" />
                <span className="settings-theme-preview-line short" />
              </span>
            </span>
            <span className="settings-theme-option-label">{o.label}</span>
            <span className="muted settings-theme-option-desc">{o.desc}</span>
          </button>
        ))}
      </div>

      <h3 className="settings-section-title settings-section-title-spaced">{t("settings.appearance.clockFormat")}</h3>
      <p className="muted settings-section-desc">{t("settings.appearance.clockFormatDesc")}</p>
      <div className="settings-theme-options" role="radiogroup" aria-label="Clock format">
        {timeOptions.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={timeFormat === o.id}
            className={`settings-theme-option${timeFormat === o.id ? " active" : ""}`}
            onClick={() => setTimeFormat(o.id)}
          >
            <span className="settings-theme-option-label">{o.label}</span>
            <span className="muted settings-theme-option-desc">{o.desc}</span>
          </button>
        ))}
      </div>

      <h3 className="settings-section-title settings-section-title-spaced">{t("settings.appearance.noteHover")}</h3>
      <label className="settings-check">
        <Switch checked={showModifiedOnHover} onCheckedChange={setShowModifiedOnHover} />
        {t("settings.appearance.showModifiedOnHover")}
      </label>

      <HeadlineShortcuts />
    </div>
  );
}

/** The three shortcuts worth knowing on day one, read-only, with a way through
 *  to the section that rebinds them. Fixed rather than "most used": tracking
 *  usage would mean recording what someone presses, which is a lot of machinery
 *  and a little surveillance for a list of three. */
const HEADLINE_COMMANDS: CommandId[] = ["search.global", "note.new", "inspector.toggle"];

function HeadlineShortcuts() {
  const { t } = useTranslation();
  const bindings = useKeybindings((s) => s.bindings);
  const setSection = useViewState((s) => s.setSettingsSection);

  return (
    <div className="settings-headline-shortcuts">
      <div className="settings-headline-head">
        <h3 className="settings-headline-title">{t("settings.appearance.headlineShortcuts")}</h3>
        <button className="settings-headline-link" onClick={() => setSection("keybindings")}>
          {t("settings.appearance.openShortcuts")} →
        </button>
      </div>
      {HEADLINE_COMMANDS.map((id) => (
        <div key={id} className="settings-row">
          <span className="settings-row-label">{t(`keybindings.commands.${id.replace(".", "_")}.label`)}</span>
          <kbd className="settings-kbd">{formatBinding(bindings[id])}</kbd>
        </div>
      ))}
    </div>
  );
}

/** Editor: how note content is set. Scoped to the document, not the chrome —
 *  both settings here change what you write in, never the app around it. */
function EditorSection() {
  const { t } = useTranslation();
  const editorFontSize = useTheme((s) => s.editorFontSize);
  const setEditorFontSize = useTheme((s) => s.setEditorFontSize);
  const dyslexiaFont = useTheme((s) => s.dyslexiaFont);
  const setDyslexiaFont = useTheme((s) => s.setDyslexiaFont);
  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t("settings.appearance.fontSize")}</h3>
      <p className="muted settings-section-desc">{t("settings.appearance.fontSizeDesc")}</p>
      <label className="settings-slider">
        <span className="settings-slider-head">
          {t("settings.appearance.fontSizeLabel")} <span className="muted">{editorFontSize}px</span>
        </span>
        <input
          type="range"
          min={EDITOR_FONT_SIZE_MIN}
          max={EDITOR_FONT_SIZE_MAX}
          step={1}
          value={editorFontSize}
          onChange={(e) => setEditorFontSize(Number(e.target.value))}
          aria-label={t("settings.appearance.fontSizeLabel")}
        />
      </label>

      <h3 className="settings-section-title settings-section-title-spaced">{t("settings.appearance.accessibility")}</h3>
      <label className="settings-check">
        <Switch checked={dyslexiaFont} onCheckedChange={setDyslexiaFont} />
        {t("settings.appearance.dyslexiaFont")}
      </label>
    </div>
  );
}

/** Interface language. One control, but it changes every string in the app, so
 *  it earns a row of its own rather than being the third heading down a page. */
function LanguageSection() {
  const { t } = useTranslation();
  const language = useLocale((s) => s.language);
  const setLanguage = useLocale((s) => s.setLanguage);
  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t("settings.appearance.language")}</h3>
      <p className="muted settings-section-desc">{t("settings.appearance.languageDesc")}</p>
      <label className="settings-field">
        <Select value={language} onValueChange={(v) => setLanguage(v as typeof language)}>
          <SelectTrigger aria-label={t("settings.appearance.language")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_LANGUAGES.map((l) => (
              <SelectItem key={l.code} value={l.code}>
                {l.nativeLabel}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {NEEDS_REVIEW[language] && (
        <p className="muted settings-section-desc">{t("settings.appearance.languageReviewNotice")}</p>
      )}
    </div>
  );
}

/** Where the open vault is on disk. Read-only: switching, adding and deleting
 *  vaults all live on the sidebar's vault-name menu (`VaultSwitcher`), which is
 *  where you already are when you're thinking about vaults. This tells you
 *  which one you're in and gets you to it in a file manager. */
function VaultSection({ vaultInfo }: { vaultInfo: VaultInfo }) {
  const { t } = useTranslation();
  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t("settings.vault.title")}</h3>
      <p className="muted settings-section-desc">{t("settings.vault.description")}</p>
      <div className="settings-row">
        <div className="settings-row-labels">
          <span className="settings-row-label">{vaultInfo.name}</span>
          <span className="settings-row-sublabel muted">{vaultInfo.path}</span>
        </div>
        <button
          className="settings-row-action"
          onClick={() => void vault.reveal(vaultInfo.path)}
          title={t("settings.vault.reveal")}
        >
          <FolderOpen className="h-4 w-4" />
          {t("settings.vault.reveal")}
        </button>
      </div>
    </div>
  );
}

/** Dictionaries section (Phase 3 step 6): enable/disable bundled language
 *  dictionaries (global app-setting) and manage the per-vault custom words. */
function DictionariesSection() {
  const { t } = useTranslation();
  const [langs, setLangs] = useState<SpellLanguages | null>(null);
  const [words, setWords] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    spellcheck.languages().then(setLangs).catch((e) => setError(localizeError(e, t)));
    spellcheck.personalWords().then(setWords).catch(() => setWords([]));
  }, [t]);
  useEffect(() => reload(), [reload]);

  const toggleLang = async (code: string, on: boolean) => {
    if (!langs) return;
    const enabled = on ? [...langs.enabled, code] : langs.enabled.filter((c) => c !== code);
    try {
      await spellcheck.setLanguages(enabled);
      reload();
    } catch (e) {
      setError(localizeError(e, t));
    }
  };

  const removeWord = async (w: string) => {
    try {
      await spellcheck.removeWord(w);
      setWords((ws) => ws.filter((x) => x !== w));
    } catch (e) {
      setError(localizeError(e, t));
    }
  };

  if (!langs) return <div className="muted">{t("common.loading")}</div>;

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t("settings.dictionaries.title")}</h3>
      <p className="muted settings-section-desc">{t("settings.dictionaries.description")}</p>

      <div className="settings-field">
        <span className="settings-field-label">{t("settings.dictionaries.languages")}</span>
        {langs.available.length === 0 ? (
          <p className="muted">{t("settings.dictionaries.noneBundled")}</p>
        ) : (
          langs.available.map((code) => (
            <label key={code} className="settings-check">
              <Switch
                checked={langs.enabled.includes(code)}
                onCheckedChange={(checked) => toggleLang(code, checked)}
              />
              {code}
            </label>
          ))
        )}
      </div>

      <div className="settings-field">
        <span className="settings-field-label">{t("settings.dictionaries.customWords")}</span>
        {words.length === 0 ? (
          <p className="muted">{t("settings.dictionaries.noCustomWords")}</p>
        ) : (
          <ul className="settings-wordlist">
            {words.map((w) => (
              <li key={w}>
                <span>{w}</span>
                <button
                  onClick={() => removeWord(w)}
                  title={t("settings.dictionaries.removeWord", { word: w })}
                  aria-label={t("settings.dictionaries.removeWord", { word: w })}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** Persisted backup preferences (global app-settings, cross-vault). */
interface BackupSettings {
  destDir?: string;
  lastArchive?: string;
  lastAt?: string;
}
const BACKUP_SETTINGS = "backup";

/**
 * Backup section (Phase 3 step 3, minimal): choose a destination folder OUTSIDE
 * the vault and run a one-click `.zip` snapshot. The destination + last result
 * persist through Rust app-settings (never localStorage). Fuller polish is step 6.
 */
function BackupSection() {
  const { t } = useTranslation();
  // null = still loading the saved settings.
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    appSettings
      .read<BackupSettings>(BACKUP_SETTINGS)
      .then((s) => setSettings(s ?? {}))
      .catch(() => setSettings({}));
  }, []);

  const persist = async (next: BackupSettings) => {
    setSettings(next);
    await appSettings.write(BACKUP_SETTINGS, next).catch((e) => setError(localizeError(e, t)));
  };

  const choose = async () => {
    const dir = await pickDirectory(t("settings.backup.destination"));
    if (dir) await persist({ ...settings, destDir: dir });
  };

  const runBackup = async () => {
    if (!settings?.destDir) return;
    setBusy(true);
    setError(null);
    try {
      const archive = await backup.run(settings.destDir);
      await persist({ ...settings, destDir: settings.destDir, lastArchive: archive, lastAt: new Date().toISOString() });
    } catch (e) {
      setError(localizeError(e, t));
    } finally {
      setBusy(false);
    }
  };

  if (settings === null) return <div className="muted">{t("common.loading")}</div>;

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t("settings.backup.title")}</h3>
      <p className="muted settings-section-desc">{t("settings.backup.description")}</p>
      <div className="settings-field">
        <span className="settings-field-label">{t("settings.backup.destination")}</span>
        <div className="settings-field-value">
          <span className={settings.destDir ? "settings-path" : "muted"}>
            {settings.destDir ?? t("common.notSet")}
          </span>
          <Button variant="outline" size="sm" onClick={choose}>
            {t("common.choose")}
          </Button>
        </div>
      </div>
      <div className="settings-actions">
        <Button size="sm" disabled={!settings.destDir || busy} onClick={runBackup}>
          {busy ? t("settings.backup.backingUp") : t("settings.backup.backUpNow")}
        </Button>
      </div>
      {settings.lastArchive && settings.lastAt && (
        <p className="muted settings-backup-last">
          {t("settings.backup.lastBackup", {
            date: new Date(settings.lastAt).toLocaleString(),
            archive: settings.lastArchive,
          })}
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/**
 * Import section (the multi-app import feature's entry point in Settings):
 * launch buttons for `import/ImportDialog.tsx`, one per source app. Always
 * imports into a NEW, empty vault — the dialog itself owns that flow; this
 * section is just the launch points.
 */
function ImportSection({ onOpenImport }: { onOpenImport?: (source: "obsidian" | "notion" | "anytype") => void }) {
  const { t } = useTranslation();
  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t("settings.import.title")}</h3>
      <p className="muted settings-section-desc">{t("settings.import.description")}</p>
      <div className="settings-actions">
        <Button size="sm" onClick={() => onOpenImport?.("obsidian")}>
          {t("settings.import.fromObsidian")}
        </Button>
        <Button size="sm" onClick={() => onOpenImport?.("notion")}>
          {t("settings.import.fromNotion")}
        </Button>
        <Button size="sm" onClick={() => onOpenImport?.("anytype")}>
          {t("settings.import.fromAnytype")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Maintenance section: vault cleanup. Deletes every note whose **body** is empty
 * (regardless of title), keeping notes that hold images/tables/other non-text
 * content. Destructive and irreversible, so the button reveals an inline confirm
 * before running.
 */
/** Human-readable byte size for the attachment-cleanup result line. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function MaintenanceSection({ onCleaned }: { onCleaned?: (ids: string[]) => void }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Unused-attachments sweep — independent state from the empty-note cleanup.
  const [attBusy, setAttBusy] = useState(false);
  const [attResult, setAttResult] = useState<CleanupReport | null>(null);
  const [attError, setAttError] = useState<string | null>(null);

  const runCleanup = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const deleted = await notes.cleanupEmpty();
      setResult(deleted.length);
      onCleaned?.(deleted);
    } catch (e) {
      setError(localizeError(e, t));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const runAttachmentCleanup = async () => {
    setAttBusy(true);
    setAttError(null);
    setAttResult(null);
    try {
      setAttResult(await attachments.cleanupOrphans());
    } catch (e) {
      setAttError(localizeError(e, t));
    } finally {
      setAttBusy(false);
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t("settings.maintenance.vaultCleanupTitle")}</h3>
      <p className="muted settings-section-desc">{t("settings.maintenance.vaultCleanupDesc")}</p>
      <div className="settings-actions">
        {confirming ? (
          <>
            <Button variant="destructive" size="sm" disabled={busy} onClick={runCleanup}>
              {busy ? t("settings.maintenance.cleaningUp") : t("settings.maintenance.deleteEmptyNotes")}
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
              {t("common.cancel")}
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => { setResult(null); setError(null); setConfirming(true); }}>
            {t("settings.maintenance.cleanUpVault")}
          </Button>
        )}
      </div>
      {result !== null && (
        <p className="muted settings-backup-last">
          {result === 0
            ? t("settings.maintenance.noEmptyNotes")
            : t("settings.maintenance.deletedEmptyNotes", { count: result })}
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <h3 className="settings-section-title settings-section-title-spaced">{t("settings.maintenance.unusedAttachmentsTitle")}</h3>
      <p className="muted settings-section-desc">{t("settings.maintenance.unusedAttachmentsDesc")}</p>
      <div className="settings-actions">
        <Button variant="outline" size="sm" disabled={attBusy} onClick={runAttachmentCleanup}>
          {attBusy ? t("settings.maintenance.cleaningUp") : t("settings.maintenance.cleanUpAttachments")}
        </Button>
      </div>
      {attResult !== null && (
        <p className="muted settings-backup-last">
          {attResult.removed === 0
            ? t("settings.maintenance.noUnusedAttachments")
            : t("settings.maintenance.freedSpace", {
                size: formatBytes(attResult.bytes ?? 0),
                count: attResult.removed,
              })}
        </p>
      )}
      {attError && <p className="error">{attError}</p>}
    </div>
  );
}

function KeybindingsSection() {
  const { t } = useTranslation();
  const bindings = useKeybindings((s) => s.bindings);
  const setBinding = useKeybindings((s) => s.setBinding);
  const resetBinding = useKeybindings((s) => s.resetBinding);
  const resetAll = useKeybindings((s) => s.resetAll);
  const [recording, setRecording] = useState<CommandId | null>(null);

  const conflicts = findConflicts(bindings);

  // While recording, capture the next real key combo (ignoring lone modifiers)
  // in the capture phase, so it never leaks to the app's global shortcut
  // dispatcher or types into a field. Escape cancels without binding.
  useEffect(() => {
    if (!recording) return;
    const id = recording;
    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        setRecording(null);
        return;
      }
      const binding = eventToBinding(e);
      if (binding === null) return; // still holding only modifiers — keep waiting
      setBinding(id, binding);
      setRecording(null);
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [recording, setBinding]);

  return (
    <div className="keybindings">
      <div className="keybindings-list">
        {COMMANDS.map((cmd) => {
          const inConflict = conflicts.has(cmd.id);
          const key = cmd.id.replace(/\./g, "_");
          const label = t(`settings.keybindings.commands.${key}.label`);
          return (
            <div key={cmd.id} className="keybinding-row">
              <div className="keybinding-info">
                <span className="keybinding-label">{label}</span>
                <span className="keybinding-desc muted">{t(`settings.keybindings.commands.${key}.description`)}</span>
                {inConflict && (
                  <span className="keybinding-conflict">
                    {t("settings.keybindings.conflict")}
                  </span>
                )}
              </div>
              <div className="keybinding-actions">
                <Button
                  variant={recording === cmd.id ? "default" : "outline"}
                  size="sm"
                  className="keybinding-key"
                  onClick={() => setRecording(recording === cmd.id ? null : cmd.id)}
                  aria-label={t("settings.keybindings.rebind", { label })}
                >
                  {recording === cmd.id ? t("settings.keybindings.pressKeys") : formatBinding(bindings[cmd.id])}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => resetBinding(cmd.id)}
                  title={t("settings.keybindings.resetToDefault")}
                  aria-label={t("settings.keybindings.resetToDefaultFor", { label })}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="keybindings-footer">
        <Button variant="ghost" size="sm" onClick={resetAll}>
          {t("settings.keybindings.resetAll")}
        </Button>
      </div>
    </div>
  );
}
