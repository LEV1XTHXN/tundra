# Note templates

Reusable, `Note`-shaped documents the user inserts into a blank note. Same block
model and editor as a normal note, but stored **outside** `notes/` so they never
appear in the tree, search, links, or graph — the exact "not one of the vault's
notes" treatment the quick-note scratchpad already gets.

## Storage

Each template is one JSON file under the vault's top-level `templates/` directory
(a sibling of `notes/` and `attachments/`, created in `vault::DIRS`):

```
MyVault/
  notes/
  templates/            # ← reusable note templates, one JSON per template
  attachments/
```

Because it's a top-level vault folder, backups pick it up automatically — the
backup module only excludes `.vault/cache/`, so no change was needed there
(`crates/tundra-core/src/backup.rs`).

Unlike notes, templates are **not** in the in-memory vault index. The collection
is tiny (a handful), so template ops just scan `templates/` directly. This keeps
`Vault::open` and the note index untouched at the cost of an O(n) directory walk
on user-triggered actions (never a hot path). See the `// --- templates ---`
section in `crates/tundra-core/src/vault.rs`:

- `list_templates() -> Vec<TemplateSummary>` (id/title/icon, title-sorted)
- `create_template(title) -> Note`
- `read_template(id) -> Note`
- `save_template(note)` — validated + atomic like any note; falls back to a fresh
  path if the id isn't found on disk (mirrors `save_note`)
- `delete_template(id)`

`TemplateSummary` is a lightweight listing DTO (exported from `lib.rs`). The five
commands (`src-tauri/src/commands.rs`, registered in `src-tauri/src/lib.rs`)
deliberately **do not** touch the search or link indexes — templates are outside
the notes tree, same as the quick note. The `templates` service object wraps them
(`src/services/index.ts`).

## Authoring

Two paths, both landing in the same on-disk format:

1. **Save an existing note as a template** — the "Save as template" button in the
   note header (`BookmarkPlus` icon). Prompts for a name
   (`src/templates/SaveAsTemplateDialog.tsx`), then `templates.create(name)` +
   `templates.save(...)` with the note's live blocks and icon.
2. **Author from scratch / manage** — either the **Templates section in the
   sidebar** (`src/nav/SidebarSections.tsx`) or Settings ▸ **Templates**
   (`TemplatesSection` in `src/settings/SettingsDialog.tsx`). "+"/"New template"
   creates a blank one and opens it for editing; rows open for edit, with delete.

The template list is held in a small store, `src/store/templates.ts`
(`useTemplates`, `{ list, refresh }`) — the same class of services-backed listing
state as `linkTitles`, never note content. The sidebar section, the Settings
manager, and the editor's "Save as template" all read it and call `refresh()`
after any create/edit/delete so both surfaces stay in sync. App refreshes it on
vault change.

### Sidebar sections

`src/nav/SidebarSections.tsx` renders two collapsible sections ABOVE the folder/
note tree, deliberately kept out of the virtualized `NavTree` (whose flatten +
drag-and-drop are note/folder-specific):

- **Pinned** — every pinned note across the vault, gathered for quick access
  (derived in `App.tsx` from `noteSummaries`; the note still also appears in its
  folder in the tree). Shown only when something is pinned.
- **Templates** — the `useTemplates` list; click to edit, "+" to create, per-row
  delete (routed through App's shared `AlertDialog`, `PendingDelete` kind
  `"template"`).

Editing launched from the sidebar returns to the prior view on "Done"; launched
from Settings it reopens the Settings dialog (`templateReturn` ref in `App.tsx`).

### Editing a template reuses `NoteEditor`

Rather than fork the editor, `NoteEditor` is parameterized by a `NotePersistence`
(`{ read, save }`) and a `mode` (`"note" | "template"`), both optional and
defaulting to the notes path. The Templates manager opens a template in the main
pane with `persistence={TEMPLATE_PERSISTENCE}` and `mode="template"`, which:

- routes read/save to `templates.*` instead of `notes.*`, and
- hides note-only chrome (pin, Use/Save-template).

It lives in the `template` app view (`src/store/viewState.ts` →
`openTemplate`/`templateEditId`), rendered by `App.tsx` with a "Done editing
template" bar (`.template-editor*` styles). The file watcher only watches
`notes/`, so template files never emit external-change events — the editor's
reconciliation subscription simply never fires for them.

## Applying a template

The editor's **Use template** action (`LayoutTemplate` icon in the header, or the
`template.use` shortcut — default **Alt+T**, rebindable in Settings) opens
`TemplatePicker` and, on pick, inserts the template via `useTemplate` in
`src/editor/NoteEditor.tsx`.

**Smart apply** (`src/templates/applyTemplate.ts`, unit-tested):

- `isEmptyDocument(blocks)` decides "blank". Its emptiness rule mirrors the Rust
  `document` module's `TEXT_BLOCK_TYPES` / `is_empty` — any non-text block, or any
  non-whitespace text, counts as content.
- **Blank note** → `editor.replaceBlocks(editor.document, …)` (body replaced).
- **Note with content** → `editor.insertBlocks(…, cursorBlock, "after")` (existing
  writing is never destroyed).
- `stripBlockIds(blocks)` removes every block `id` first so BlockNote assigns
  fresh, unique ones. Without this, inserting the same template twice into one note
  would collide ids and `Note::validate` would reject the save (block ids must be
  unique per note).

BlockNote doesn't reliably fire `onChange` for these programmatic edits, so
`useTemplate` calls `scheduleSave()` itself.

## Gotchas / notes

- **Block-id regeneration is mandatory**, not cosmetic — it's what keeps the
  CRDT-ready "unique block id per note" invariant (CLAUDE.md §5.3) true after an
  insert, and what makes inserting the same template twice safe.
- Templates carry an icon (copied on "Save as template") but the apply action
  intentionally touches **body blocks only** — it never overwrites the target
  note's title or icon.
- Adding a template command? It's a note-shaped passthrough; regenerate
  `bindings.ts` the usual way (see [`ipc-and-bindings.md`](ipc-and-bindings.md)).
