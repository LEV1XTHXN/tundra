/**
 * The settings surface (CLAUDE.md §6.2 `settings`). First section is keybinding
 * rebinding; the left rail is structured so Appearance/Backup/etc. slot in later.
 * Preferences are owned by the keybindings store (persisted via Rust); React
 * only renders and captures the user's chosen combos.
 */
import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { COMMANDS, type CommandId } from "@/keybindings/registry";
import { eventToBinding, formatBinding } from "@/keybindings/binding";
import { findConflicts, useKeybindings } from "@/store/keybindings";
import { EDITOR_FONT_SIZE_MAX, EDITOR_FONT_SIZE_MIN, useTheme, type ThemePref, type TimeFormatPref } from "@/store/theme";
import { appSettings, attachments, backup, notes, pickDirectory, spellcheck, tags as tagsService, templates } from "@/services";
import type { CleanupReport, SpellLanguages } from "@/services";
import { useTemplates } from "@/store/templates";
import {
  kanbanTagChipStyle,
  tagChipStyle,
  useKanbanTags,
  useTagColors,
  useVaultTags,
} from "@/store/tagColors";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a vault cleanup with the ids that were deleted, so the app can
   *  refresh the note tree and close the open note if it was one of them. */
  onCleaned?: (deletedIds: string[]) => void;
  /** Open a template for editing in the main pane (closes the dialog); the
   *  Templates section calls this for "New template" and "Edit". */
  onEditTemplate?: (id: string) => void;
  /** Called after a tag is deleted vault-wide, so the app can refresh the note
   *  tree/summaries (the open note's chips, nav, etc. reflect the removal). */
  onTagsChanged?: () => void;
  /** Open the "Import from Obsidian" flow (closes this dialog first — it
   *  needs the full window, same pattern as `onEditTemplate`). */
  onOpenImport?: () => void;
}

const SECTIONS = [
  { id: "appearance", label: "Appearance" },
  { id: "keybindings", label: "Keybindings" },
  { id: "templates", label: "Templates" },
  { id: "tags", label: "Tags" },
  { id: "dictionaries", label: "Dictionaries" },
  { id: "backup", label: "Backup" },
  { id: "import", label: "Import" },
  { id: "maintenance", label: "Maintenance" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

export function SettingsDialog({
  open,
  onOpenChange,
  onCleaned,
  onEditTemplate,
  onTagsChanged,
  onOpenImport,
}: SettingsDialogProps) {
  const [section, setSection] = useState<SectionId>("keybindings");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="settings-dialog sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Customize how Tundra works.</DialogDescription>
        </DialogHeader>
        <div className="settings-body">
          <nav className="settings-rail" aria-label="Settings sections">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`settings-rail-item${section === s.id ? " active" : ""}`}
                onClick={() => setSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>
          <div className="settings-pane">
            {section === "appearance" && <AppearanceSection />}
            {section === "keybindings" && <KeybindingsSection />}
            {section === "templates" && <TemplatesSection onEditTemplate={onEditTemplate} />}
            {section === "tags" && <TagsSection onChanged={onTagsChanged} />}
            {section === "dictionaries" && <DictionariesSection />}
            {section === "backup" && <BackupSection />}
            {section === "import" && <ImportSection onOpenImport={onOpenImport} />}
            {section === "maintenance" && <MaintenanceSection onCleaned={onCleaned} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Appearance section (Phase 3 step 6): theme preference (system/light/dark)
 *  and clock format (24h/12h), applied app-wide via the theme store and
 *  persisted through Rust app-settings. */
function AppearanceSection() {
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);
  const timeFormat = useTheme((s) => s.timeFormat);
  const setTimeFormat = useTheme((s) => s.setTimeFormat);
  const showModifiedOnHover = useTheme((s) => s.showModifiedOnHover);
  const setShowModifiedOnHover = useTheme((s) => s.setShowModifiedOnHover);
  const editorFontSize = useTheme((s) => s.editorFontSize);
  const setEditorFontSize = useTheme((s) => s.setEditorFontSize);
  const dyslexiaFont = useTheme((s) => s.dyslexiaFont);
  const setDyslexiaFont = useTheme((s) => s.setDyslexiaFont);
  const options: { id: ThemePref; label: string; desc: string }[] = [
    { id: "system", label: "System", desc: "Follow the operating system" },
    { id: "light", label: "Light", desc: "Always light" },
    { id: "dark", label: "Dark", desc: "Always dark" },
  ];
  const timeOptions: { id: TimeFormatPref; label: string; desc: string }[] = [
    { id: "24h", label: "24-hour", desc: "13:00" },
    { id: "12h", label: "12-hour", desc: "1:00 PM" },
  ];
  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Appearance</h3>
      <p className="muted settings-section-desc">Choose the app theme. “System” follows your OS and updates live.</p>
      <div className="settings-theme-options" role="radiogroup" aria-label="Theme">
        {options.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={theme === o.id}
            className={`settings-theme-option${theme === o.id ? " active" : ""}`}
            onClick={() => setTheme(o.id)}
          >
            <span className="settings-theme-option-label">{o.label}</span>
            <span className="muted settings-theme-option-desc">{o.desc}</span>
          </button>
        ))}
      </div>

      <h3 className="settings-section-title settings-section-title-spaced">Clock format</h3>
      <p className="muted settings-section-desc">Used by the calendar's hourly view.</p>
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

      <h3 className="settings-section-title settings-section-title-spaced">Font size</h3>
      <p className="muted settings-section-desc">Applies to note and quick-note content in the editor.</p>
      <label className="settings-slider">
        <span className="settings-slider-head">
          Size <span className="muted">{editorFontSize}px</span>
        </span>
        <input
          type="range"
          min={EDITOR_FONT_SIZE_MIN}
          max={EDITOR_FONT_SIZE_MAX}
          step={1}
          value={editorFontSize}
          onChange={(e) => setEditorFontSize(Number(e.target.value))}
          aria-label="Font size"
        />
      </label>

      <h3 className="settings-section-title settings-section-title-spaced">Accessibility</h3>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={dyslexiaFont}
          onChange={(e) => setDyslexiaFont(e.target.checked)}
        />
        Use a dyslexia-friendly font (OpenDyslexic) in the editor
      </label>

      <h3 className="settings-section-title settings-section-title-spaced">Note hover</h3>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={showModifiedOnHover}
          onChange={(e) => setShowModifiedOnHover(e.target.checked)}
        />
        Show last-modified date when hovering a note
      </label>
    </div>
  );
}

/**
 * Tags section: manage the vault's tags as first-class things (not per-note).
 * Lists every tag in use; deleting one removes it from *every* note it's on
 * (permanent, via `tags.delete`) and clears its color. Kanban-column tags are
 * shown but not deletable here — they're owned by their board column.
 */
function TagsSection({ onChanged }: { onChanged?: () => void }) {
  const vaultTags = useVaultTags((s) => s.tags);
  const reloadVaultTags = useVaultTags((s) => s.load);
  const tagColors = useTagColors((s) => s.colors);
  const setTagColor = useTagColors((s) => s.setColor);
  const kanbanTags = useKanbanTags((s) => s.tags);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const q = filter.trim().toLowerCase();
  const visibleTags = q ? vaultTags.filter((t) => t.toLowerCase().includes(q)) : vaultTags;

  const deleteTag = async (tag: string) => {
    setError(null);
    try {
      await tagsService.delete(tag);
      await setTagColor(tag, null); // the tag no longer exists — drop its color
      await reloadVaultTags();
      onChanged?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Tags</h3>
      <p className="muted settings-section-desc">
        Every tag in the vault. Deleting a tag removes it from all notes and can’t be undone.
      </p>

      {vaultTags.length > 0 && (
        <input
          className="settings-tag-search"
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search tags…"
          aria-label="Search tags"
        />
      )}

      {vaultTags.length === 0 ? (
        <p className="muted">No tags yet — add tags to a note from its info panel.</p>
      ) : visibleTags.length === 0 ? (
        <p className="muted">No tags match “{filter.trim()}”.</p>
      ) : (
        <ul className="settings-taglist">
          {visibleTags.map((t) => {
            const isKanban = kanbanTags.has(t);
            return (
              <li key={t}>
                <span
                  className="settings-tag-chip"
                  style={isKanban ? kanbanTagChipStyle(tagColors[t]) : tagChipStyle(tagColors[t])}
                >
                  #{t}
                </span>
                {isKanban ? (
                  <span className="muted settings-tag-managed">Managed by a Kanban column</span>
                ) : pending === t ? (
                  <span className="settings-tag-confirm">
                    <button className="settings-tag-danger" onClick={() => void deleteTag(t)}>
                      Delete
                    </button>
                    <button onClick={() => setPending(null)}>Cancel</button>
                  </span>
                ) : (
                  <button
                    className="settings-tag-delete"
                    onClick={() => setPending(t)}
                    title={`Delete #${t} from all notes`}
                    aria-label={`Delete tag ${t}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** Dictionaries section (Phase 3 step 6): enable/disable bundled language
 *  dictionaries (global app-setting) and manage the per-vault custom words. */
function DictionariesSection() {
  const [langs, setLangs] = useState<SpellLanguages | null>(null);
  const [words, setWords] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    spellcheck.languages().then(setLangs).catch((e) => setError(String(e)));
    spellcheck.personalWords().then(setWords).catch(() => setWords([]));
  }, []);
  useEffect(() => reload(), [reload]);

  const toggleLang = async (code: string, on: boolean) => {
    if (!langs) return;
    const enabled = on ? [...langs.enabled, code] : langs.enabled.filter((c) => c !== code);
    try {
      await spellcheck.setLanguages(enabled);
      reload();
    } catch (e) {
      setError(String(e));
    }
  };

  const removeWord = async (w: string) => {
    try {
      await spellcheck.removeWord(w);
      setWords((ws) => ws.filter((x) => x !== w));
    } catch (e) {
      setError(String(e));
    }
  };

  if (!langs) return <div className="muted">Loading…</div>;

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Dictionaries</h3>
      <p className="muted settings-section-desc">Enable spellcheck languages and manage words you’ve added.</p>

      <div className="settings-field">
        <span className="settings-field-label">Languages</span>
        {langs.available.length === 0 ? (
          <p className="muted">No dictionaries are bundled yet.</p>
        ) : (
          langs.available.map((code) => (
            <label key={code} className="settings-check">
              <input
                type="checkbox"
                checked={langs.enabled.includes(code)}
                onChange={(e) => toggleLang(code, e.target.checked)}
              />
              {code}
            </label>
          ))
        )}
      </div>

      <div className="settings-field">
        <span className="settings-field-label">Custom words</span>
        {words.length === 0 ? (
          <p className="muted">No custom words yet — add them from the editor’s right-click menu.</p>
        ) : (
          <ul className="settings-wordlist">
            {words.map((w) => (
              <li key={w}>
                <span>{w}</span>
                <button onClick={() => removeWord(w)} title={`Remove “${w}”`} aria-label={`Remove ${w}`}>
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
    await appSettings.write(BACKUP_SETTINGS, next).catch((e) => setError(String(e)));
  };

  const choose = async () => {
    const dir = await pickDirectory("Choose a backup destination");
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
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (settings === null) return <div className="muted">Loading…</div>;

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Backup</h3>
      <p className="muted settings-section-desc">
        Save a compressed <code>.zip</code> snapshot of the whole vault (excluding the
        rebuildable search/graph cache) to a folder outside the vault.
      </p>
      <div className="settings-field">
        <span className="settings-field-label">Destination</span>
        <div className="settings-field-value">
          <span className={settings.destDir ? "settings-path" : "muted"}>{settings.destDir ?? "Not set"}</span>
          <Button variant="outline" size="sm" onClick={choose}>
            Choose…
          </Button>
        </div>
      </div>
      <div className="settings-actions">
        <Button size="sm" disabled={!settings.destDir || busy} onClick={runBackup}>
          {busy ? "Backing up…" : "Back up now"}
        </Button>
      </div>
      {settings.lastArchive && settings.lastAt && (
        <p className="muted settings-backup-last">
          Last backup {new Date(settings.lastAt).toLocaleString()} → <code>{settings.lastArchive}</code>
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/**
 * Import section (step 1 of the multi-app import feature): the entry point
 * for `import/ImportDialog.tsx`. Always imports into a NEW, empty vault —
 * the dialog itself owns that flow; this section is just the launch button.
 */
function ImportSection({ onOpenImport }: { onOpenImport?: () => void }) {
  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Import</h3>
      <p className="muted settings-section-desc">
        Bring notes in from another app. Always imports into a new, empty vault — your
        currently open vault is never touched or merged into.
      </p>
      <div className="settings-actions">
        <Button size="sm" onClick={() => onOpenImport?.()}>
          Import from Obsidian…
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
      setError(String(e));
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
      setAttError(String(e));
    } finally {
      setAttBusy(false);
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Vault cleanup</h3>
      <p className="muted settings-section-desc">
        Delete every note with an empty body to tidy up notes you started but never
        wrote in. Notes containing images, tables, or other non-text blocks are kept,
        even if they have no text. This cannot be undone.
      </p>
      <div className="settings-actions">
        {confirming ? (
          <>
            <Button variant="destructive" size="sm" disabled={busy} onClick={runCleanup}>
              {busy ? "Cleaning up…" : "Delete empty notes"}
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => { setResult(null); setError(null); setConfirming(true); }}>
            Clean up vault
          </Button>
        )}
      </div>
      {result !== null && (
        <p className="muted settings-backup-last">
          {result === 0 ? "No empty notes found." : `Deleted ${result} empty note${result === 1 ? "" : "s"}.`}
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <h3 className="settings-section-title settings-section-title-spaced">Unused attachments</h3>
      <p className="muted settings-section-desc">
        Remove image, video, and file attachments that no note, template, or quick note
        uses anymore — left behind when you delete an embed or a note. Attachments still
        referenced anywhere are always kept. This cannot be undone.
      </p>
      <div className="settings-actions">
        <Button variant="outline" size="sm" disabled={attBusy} onClick={runAttachmentCleanup}>
          {attBusy ? "Cleaning up…" : "Clean up unused attachments"}
        </Button>
      </div>
      {attResult !== null && (
        <p className="muted settings-backup-last">
          {attResult.removed === 0
            ? "No unused attachments found."
            : `Freed ${formatBytes(attResult.bytes ?? 0)} (${attResult.removed} file${attResult.removed === 1 ? "" : "s"} removed).`}
        </p>
      )}
      {attError && <p className="error">{attError}</p>}
    </div>
  );
}

/**
 * Templates section: manage reusable note templates. Create a blank template
 * (opens it in the editor), edit an existing one, or delete it. Templates are
 * stored by Rust outside `notes/`, so they never appear in the tree/search/graph.
 * Note that a note can also be turned into a template from its header
 * ("Save as template"); this section is the from-scratch / management path.
 */
function TemplatesSection({ onEditTemplate }: { onEditTemplate?: (id: string) => void }) {
  const list = useTemplates((s) => s.list);
  const loaded = useTemplates((s) => s.loaded);
  const refresh = useTemplates((s) => s.refresh);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const newTemplate = async () => {
    try {
      const tpl = await templates.create("Untitled template");
      await refresh();
      onEditTemplate?.(tpl.id);
    } catch (e) {
      setError(String(e));
    }
  };

  const remove = async (id: string) => {
    try {
      await templates.delete(id);
      setConfirmId(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Templates</h3>
      <p className="muted settings-section-desc">
        Reusable note layouts. Insert one into any note with the “Use template” button in its
        header (or the shortcut). Create one here from scratch, or save an existing note as a
        template from its header.
      </p>

      <div className="settings-actions">
        <Button size="sm" onClick={() => void newTemplate()}>
          <Plus className="h-4 w-4" /> New template
        </Button>
      </div>

      {!loaded ? (
        <div className="muted">Loading…</div>
      ) : list.length === 0 ? (
        <p className="muted">No templates yet.</p>
      ) : (
        <ul className="settings-wordlist settings-templatelist">
          {list.map((t) => (
            <li key={t.id}>
              <span className="settings-template-name">{t.title || "Untitled template"}</span>
              {confirmId === t.id ? (
                <span className="settings-template-confirm">
                  <button className="settings-template-danger" onClick={() => void remove(t.id)}>
                    Delete
                  </button>
                  <button onClick={() => setConfirmId(null)}>Cancel</button>
                </span>
              ) : (
                <span className="settings-template-actions">
                  <button onClick={() => onEditTemplate?.(t.id)} title="Edit template" aria-label={`Edit ${t.title}`}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setConfirmId(t.id)} title="Delete template" aria-label={`Delete ${t.title}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function KeybindingsSection() {
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
          return (
            <div key={cmd.id} className="keybinding-row">
              <div className="keybinding-info">
                <span className="keybinding-label">{cmd.label}</span>
                <span className="keybinding-desc muted">{cmd.description}</span>
                {inConflict && (
                  <span className="keybinding-conflict">
                    Conflicts with another shortcut on the same keys.
                  </span>
                )}
              </div>
              <div className="keybinding-actions">
                <Button
                  variant={recording === cmd.id ? "default" : "outline"}
                  size="sm"
                  className="keybinding-key"
                  onClick={() => setRecording(recording === cmd.id ? null : cmd.id)}
                  aria-label={`Rebind ${cmd.label}`}
                >
                  {recording === cmd.id ? "Press keys…" : formatBinding(bindings[cmd.id])}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => resetBinding(cmd.id)}
                  title="Reset to default"
                  aria-label={`Reset ${cmd.label} to default`}
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
          Reset all to defaults
        </Button>
      </div>
    </div>
  );
}
