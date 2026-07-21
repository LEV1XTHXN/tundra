# Tundra — Phase 3 Master Build Document

Phase 3 = **Productivity layer**: calendar + note-date linking, backup-to-archive, multilingual spellcheck + custom dictionary, and settings polish. This is the single source for building it.

## How to use this file (for Claude Code)

- Work **one step at a time, in order** (Step 1 → Step 6). Don't skip or combine steps.
- The **Preamble** applies to every step. **All Phase 1 & 2 invariants still hold** (strict layering — only `src/services/` imports `@tauri-apps/api`; done-bar = code + tests + a demonstrated acceptance check; specta pinned at `2.0.0-rc.25`; atomic writes; self-write registry; `.vault/cache/` is derived/rebuildable; every block keeps its stable `id`). Preamble wins over your own judgment; surface any new fork instead of guessing.
- **Read the current code first and match it.** Phase 1 & 2 are built. Key facts you will build on:
  - Core crate `tundra-core`: modules `document`, `error`, `index` (Tantivy search), `links` (id-backed link graph), `vault`, `watcher`. Schema is **v2** with a lazy migration in `document.rs` (`Note::migrate`, applied through the single `read_note_at` choke point).
  - `NoteMeta` (`pinned`, `tags`) and `NoteSummary` (adds `icon`, `pinned`) use `#[serde(default)]`, so new optional fields are backward-compatible **without** a schema bump. `pinned` is mirrored from `NoteMeta` into `NoteSummary` and the in-memory index — the pattern to copy for any new summary-visible field.
  - The vault holds an in-memory `id → {path, summary}` index + folder set (`Arc<RwLock<_>>`), a self-write registry, atomic `write_note_at` (tempfile persist + fsync + rolling `.bak`), and generic **`read_config`/`write_config`** for atomic, path-traversal-guarded files under `.vault/config/`.
  - Tauri layer: commands are `#[tauri::command] #[specta::specta]`, resolve state via `current(&state)` (and `current_search`/`current_links`), and are registered in `collect_commands!`; typed events in `collect_events!`. `AppState` holds `vault` + `search` + `links` + `watcher`, all opened and caught-up in `open_vault`. There are **`read/write_app_settings`** (global, OS config dir) and **`read/write_vault_config`** (per-vault) command pairs already.
  - Frontend: a shell `VIEWS` switcher in `App.tsx` (`home / editor / graph / quicknotes`) driven by `useViewState`; a `SettingsDialog`, a `NoteInspector`, a keybindings system (`store/keybindings`, app-settings-backed), `date-fns`-free so far. Services are namespaced (`vault`, `notes`, `folders`, `links`, `search`, `config`, `appSettings`, `attachments`, `watcher`). `.vault/dictionaries/` is already created on vault open.
- Each step ends with a **done-bar**. Meet it before the next step. After Step 6, run the **Phase 3 verification pass**.
- Do **not** start Phase 4 (sync/CRDT/mobile) or Phase 5 (AI).

---

# PREAMBLE — Phase 3 locked decisions (authoritative; additive to Phase 1 & 2)

## Calendar — dedicated event store + note-date links in meta

- **Events are first-class records** (including standalone events and multi-day time periods), owned by a new core `calendar` module and persisted to a dedicated **in-vault** file that the backup includes and that MAY sync — NOT under `.vault/cache/`. Reuse the atomic-write discipline (`write_config`-style) — e.g. `.vault/config/calendar.json` — so events survive crashes/backup/sync. An event has at least: `id`, `title`, `start`, optional `end` (for periods), `allDay`, optional linked note ids, optional color.
- **Note→date links live on the note**: extend `NoteMeta` with an optional `dates` field (`#[serde(default)]`, so no schema bump), each entry a date (and optionally an event id). To answer "notes on this date/range" responsively at the ~50k target, **mirror the note's dates into `NoteSummary` + the in-memory index exactly as `pinned` is mirrored** (populated in create/save/`build_index`), so range queries never re-read files.
- The `calendar` module answers range queries by combining store events and note-date links. Any derived acceleration structure goes under `.vault/cache/` (rebuildable).

## Backup — one-click zip, outside the vault

- Produce a single **`.zip`** archive of the whole vault **excluding `.vault/cache/`**, written **outside** the vault, with a **timestamped** filename (e.g. `<VaultName>-backup-YYYYMMDD-HHMMSS.zip`). Use the `zip` crate. Verify the archive is readable before reporting success. Remember the chosen destination directory in **app-settings** (global, cross-vault) and default it via the native dialog. It's a manual, user-triggered action (a button) — no scheduling in Phase 3.

## Spellcheck — zspell engine + in-editor squiggles

- Use **`zspell`** (locked) with standard **Hunspell** dictionaries. Bundle at least `en_US` as an app resource; users can enable additional languages. The **personal/custom dictionary is per-vault** under `.vault/dictionaries/` (already created on open); adding a word writes there. A token is misspelled only if **no** enabled language dictionary and not the personal dictionary accepts it.
- **In-editor squiggles**: BlockNote is on TipTap/ProseMirror — render misspellings as a **ProseMirror decoration** plugin (underline), recomputed on doc change (debounced) over the changed/visible range, not the whole document every keystroke. **Disable the webview's native spellcheck** on the editor (`spellcheck={false}` / contentEditable) so squiggles aren't doubled. A right-click/context menu offers suggestions (from zspell) and **"Add to dictionary"** (writes the personal dict and clears the squiggle). Checking runs through the Rust `spellcheck` service — no dictionary logic in the frontend.

## Settings & shell

- Extend the **existing `SettingsDialog`** — do not build a new settings surface. Add: **Appearance** (theme: system / light / dark), **Backup** (destination + "Back up now"), and **Dictionaries** (enable languages, manage custom words). Global preferences use the existing **app-settings** commands; anything vault-scoped uses **vault-config**. Never `localStorage`.
- **Fix the hardcoded editor theme.** `NoteEditor` currently passes `theme="light"` to `BlockNoteView`; wire it to the real theme, and apply the class-based `dark` mode (following the OS by default) per the Phase 1 UI-conventions preamble, driven by the Appearance setting.
- Add a **`calendar`** entry to the shell `VIEWS` switcher (`useViewState` / `App.tsx`), mounting the calendar view lazily like `graph`.
- Vault-scoped things opened per-vault (the calendar store, and the per-vault personal dictionary) follow the **`search`/`links` lifecycle**: opened and caught-up in `open_vault`, held in `AppState`, resolved via a `current_*` helper.

## New dependencies

- Rust: `zip` (backup), `zspell` (spellcheck). Frontend: `date-fns` (calendar date math — already whitelisted).

## Out of scope for Phase 3

Sync/CRDT/mobile → Phase 4. AI → Phase 5. Keep every block's stable `id`; keep `.vault/cache/` derived.

---

# BUILD STEPS

---

## Step 1 — `calendar` module (Rust): event store + note-date links

```text
The Preamble above is authoritative. Phase 3, step 1. New core module `calendar`. Read vault.rs (read_config/write_config, the in-memory index, how `pinned` is mirrored into NoteSummary) and document.rs (NoteMeta) first, and match those patterns.

1. Event model: an Event { id (uuid), title, start (date/datetime), end (optional — time periods), all_day (bool), note_ids (Vec<String>, optional links), color (optional) }. Use chrono (already a dep).
2. Store: a CalendarStore persisted to a dedicated in-vault file (e.g. .vault/config/calendar.json) via the same atomic-write discipline as write_config — it's content, so it must be backed up and NOT under .vault/cache/. CRUD: add/update/delete/list events; query events overlapping a date range.
3. Note-date links: extend NoteMeta with `#[serde(default)] dates: Vec<NoteDate>` (a date, optionally an event id). This must NOT bump SCHEMA_VERSION (serde default handles old files). Mirror the dates into NoteSummary + the in-memory index the SAME way `pinned` is (populate in persist_new/save_note/build_index), so a range query is served from the index without re-reading note files.
4. Range query API that returns both store events and note-date links falling in a [start, end] range.
5. Commands + services wrappers (create/update/delete/list events, notes-in-range); register in collect_commands!. Follow the search/links lifecycle: open the CalendarStore in open_vault and hold it in AppState via a current_calendar helper.

Tests: event CRUD + range overlap (incl. multi-day periods spanning a range boundary); adding a date to a note surfaces it in NoteSummary and in a range query without a disk re-read; NoteMeta.dates round-trips and an OLD (dateless) note file still loads (serde default, no schema bump).

Done-bar: cargo test green; events + note-date links persist in-vault (not cache); bindings regenerate. Show changed files and test output.
```

---

## Step 2 — Calendar view (frontend)

```text
The Preamble above is authoritative. Phase 3, step 2. Add the calendar UI on top of step 1. Data through services only; never import @tauri-apps/api outside src/services/.

1. Shell: add a `calendar` entry to VIEWS in App.tsx and the useViewState switcher; mount it lazily like GraphView.
2. Views: month and week views using date-fns (whitelisted). Show events (incl. multi-day periods) and notes linked to each date.
3. Editing: create/edit/delete events; link a note to a date/event (and open a linked note by id — set the open note id + switch to the editor view, the same navigation the graph uses).
4. Style with the existing shadcn/Tailwind tokens; keep it consistent with the other views.

Tests / verification: create an event and it appears on the right day(s); a multi-day period spans the correct range; linking a note to a date shows it in the calendar and clicking it opens the note; switching months/weeks loads the correct range. Layering check passes.

Done-bar: calendar view creates/edits events and note-date links through services, navigation works, app builds (tsc + vite build). Show changed files and verification output.
```

---

## Step 3 — `backup` module (Rust) + "Back up now"

```text
The Preamble above is authoritative. Phase 3, step 3. New core `backup` module + a settings action. Read vault.rs and the app-settings commands first.

1. Backup: zip the entire vault EXCLUDING .vault/cache/, into a single .zip written to a caller-provided destination directory OUTSIDE the vault, with a timestamped name (<VaultName>-backup-YYYYMMDD-HHMMSS.zip). Use the `zip` crate. After writing, VERIFY the archive opens and its central directory is readable before returning success; return the archive path.
2. Destination: remember the chosen backup directory in app-settings (global). A backup_vault(dest_dir) command + service; the frontend picks/derives the destination via the native dialog and persists it.
3. Surface a "Back up now" action in the existing SettingsDialog (destination picker + button + last-backup feedback). Full appearance/dictionary polish is step 6 — keep this minimal but functional.

Tests: backing up a vault with cache present produces a .zip that contains notes/attachments/.vault/config but NOT .vault/cache/; the archive verifies as readable; the timestamped name is well-formed. (Test the core backup fn directly; a temp vault + temp dest.)

Done-bar: cargo test green; one-click zip backup excludes cache, lands outside the vault, and verifies; bindings regenerate; app builds. Show changed files and test output.
```

---

## Step 4 — `spellcheck` module (Rust): zspell engine + dictionaries

```text
The Preamble above is authoritative. Phase 3, step 4. New core `spellcheck` module. Engine only here; the editor UI is step 5.

1. Engine: use `zspell` with Hunspell dictionaries. Bundle at least en_US as an app resource and load it. Support enabling additional language dictionaries. Load the PER-VAULT personal dictionary from .vault/dictionaries/ (already created on open); a word there is always accepted.
2. API: check(text or tokens) -> the misspelled spans (offsets) with suggestions; add_word(word) -> append to the personal dictionary and take effect immediately. A token is misspelled only if NO enabled language dictionary AND not the personal dictionary accepts it.
3. Lifecycle: open the vault's personal dictionary in open_vault and hold the speller in AppState (current_spellcheck helper), like search/links. Language-dictionary enablement is an app-setting (global).
4. Commands + services wrappers (check, add_word, list/enable languages); register in collect_commands!.

Tests: a known-good word passes and a misspelling is flagged with plausible suggestions; a word added to the personal dictionary stops being flagged; enabling a second language accepts words from that language; offsets returned line up with the input.

Done-bar: cargo test green; zspell checks against bundled + personal dictionaries; add-to-dictionary persists per-vault; bindings regenerate. Show changed files and test output.
```

---

## Step 5 — Spellcheck in the editor (frontend, the heavy one)

```text
The Preamble above is authoritative. Phase 3, step 5. Wire step 4 into the editor. Data through services; never import @tauri-apps/api outside src/services/.

1. Disable the webview's native spellcheck on the editor surface (spellcheck={false} on the BlockNote contentEditable) so squiggles aren't doubled.
2. Decorations: add a ProseMirror plugin to BlockNote's underlying TipTap/ProseMirror editor that underlines misspelled ranges returned by services.spellcheck.check. Recompute DEBOUNCED and only over the changed/visible range — never re-check the whole document on every keystroke (this is the performance-critical part; a naive full-doc check will jank large notes).
3. Context menu on a squiggle: show suggestions (from the service) to replace the word, plus "Add to dictionary" (calls add_word, then clears that squiggle). Keyboard-accessible.
4. Keep it entirely inside the editor module; the dictionary/logic stays in Rust.

Tests / verification: a misspelled word gets a squiggle; picking a suggestion replaces it; "Add to dictionary" removes the squiggle and it stays gone after reload; typing in a large note stays responsive (debounced/range-scoped check — show it doesn't re-check the whole doc each keystroke); no double (native+custom) underlines. Layering check passes.

Done-bar: live squiggles + suggestions + add-to-dictionary work through the spellcheck service, large-note typing stays smooth, app builds. Show changed files and verification output.
```

---

## Step 6 — Settings polish (appearance, dictionaries, backup) + theme fix

```text
The Preamble above is authoritative. Phase 3, step 6 — the last build step. Round out the existing SettingsDialog. Global prefs via app-settings; vault-scoped via vault-config; never localStorage.

1. Appearance: a theme control (system / light / dark) stored in app-settings. Apply it app-wide via the class-based `dark` mode (default: follow the OS). FIX NoteEditor's hardcoded theme="light" so BlockNoteView follows the real theme too.
2. Dictionaries: UI to enable/disable language dictionaries (app-setting) and to view/remove custom words in the per-vault personal dictionary (via the spellcheck service).
3. Backup: finish the backup section from step 3 — choose/show the destination, "Back up now", and show the last backup result/time.
4. Keep everything in SettingsDialog; match the existing keybindings-section style.

Tests / verification: switching theme updates the whole app AND the editor immediately and persists across restart; toggling a language dictionary changes what the editor flags; removing a custom word re-flags it; the backup section runs a backup and reports the path. Layering check passes.

Done-bar: appearance/dictionary/backup settings all work and persist through Rust (app-settings/vault-config), the editor theme is no longer hardcoded, app builds. Show changed files and verification output.
```

---

# PHASE 3 VERIFICATION PASS (after Step 6)

- Create standalone events and multi-day periods; link notes to dates; the calendar shows both and clicking a linked note opens it. Old (pre-Phase-3) note files still load with no `dates`.
- One-click backup produces a timestamped `.zip` outside the vault that includes notes/attachments/`.vault/config` but excludes `.vault/cache/`, and verifies as readable; the destination is remembered.
- Misspellings are squiggled live; suggestions replace words; "Add to dictionary" persists per-vault and survives reload; a second language can be enabled; typing in a large note stays smooth; no doubled native underlines.
- Theme (system/light/dark) applies across the whole app including the editor and persists; the hardcoded `theme="light"` is gone.
- All Phase 1 & 2 guarantees still hold (persistence, reconciliation, search, links/graph, ~50k responsiveness).

Clear that bar and Phase 3 is done — the current planned scope (Phases 0–3) is complete. Phases 4 (sync & mobile) and 5 (local AI) remain deferred by design.
