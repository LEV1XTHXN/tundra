# Note sorting & folder table views

Two coupled features for organizing notes: **per-folder sorting** of the sidebar
tree (field sort / manual drag / pin-to-top, for notes *and* folders), and a
**folder "database" table view** (open a folder → a Notion-style table of its
contents with user-defined columns), reachable at every nesting level.

## Design decisions (locked with the user)

- **Folder-specific schema.** Each folder owns its own property definitions and
  columns — a Recipes folder and a Work folder don't share columns. (We
  deliberately did *not* go global, to avoid cluttering every folder with
  irrelevant properties.)
- **Property primitives.** Five fixed kinds — **text, number, select,
  multi-select, date** — from which the user composes named columns.
- **Independent sort.** The sidebar tree (`treeSort`) and a folder's table
  (`tableSort`) keep separate orders; they can disagree.
- **Uniform at every level.** Every folder path — nested or not — gets the same
  sort/pin/schema treatment.
- **Subfolders as drill-in rows.** In a folder's table, subfolders appear as rows
  (folder icon + name) that float above notes and are sortable by the Name column;
  custom columns are blank for them. Clicking one opens *its* table.

## Data model

### Rust core (note values only)
The core stays generic — it stores property **values** opaquely (like
`Block.props`) and never interprets the property-type system:

- `NoteMeta::properties: HashMap<String, serde_json::Value>` — a note's values,
  keyed by property id. `#[serde(default)]`, so old notes load unchanged (no
  `SCHEMA_VERSION` bump).
- Mirrored into **`NoteSummary::properties`** (like `tags`/`dates`) so the table
  renders/sorts every row without loading note bodies.
- `NoteSummary` also gained **`created`** and **`size`** (`u32`; `u64` is forbidden
  by specta and a JSON note never nears 4 GB) for the new sort options. All four
  summary-construction sites now go through `NoteSummary::from_note(note, rel, size)`.
- Command **`set_note_property(id, key, value: Option<String>)`** — `value` is a raw
  JSON string (or `null` to clear), parsed core-side. Same raw-JSON-string IPC
  boundary as the config passthrough (specta can't pass an opaque `Value` as a
  command arg). Mirrors `set_note_tags`: no-op if unchanged, no mtime churn.

### Frontend (schema + view config)
Property **definitions** and per-folder view config are presentation state, so
they live in **`.vault/config/folder-views.json`** via the existing `config`
passthrough — **no new Rust command** (same class as `tag-colors.json`). Managed
by the `useFolderViews` zustand store, keyed by folder path (`""` = root):

```
FolderView {
  pinned?            // this folder pinned within its parent (folders have no note-meta)
  treeSort?          // { by: manual|name|modified|created|size, dir }  — sidebar
  manualOrder?       // ["note:<id>" | "folder:<name>"] for treeSort.by === "manual"
  properties?        // PropertyDef[] — the folder's custom schema
  columns?           // ColumnKey[] shown in the table: builtin ("modified"|"created"|"size") or { prop: id }
  tableSort?         // TableSort[] (first = primary)  — table, independent of treeSort
}
```

`PropertyValue` (the typed shape the frontend puts on the opaque JSON) and
`PropertyType` are defined in `src/services` (data contract); the rest of the
schema types are in `src/store/folderViews.ts`.

## Sidebar (`src/nav/`)

- **`flatten.ts`** owns ordering (pure, unit-tested): pinned first; then, for a
  field sort, folders-above-notes (folders by name, notes by the field); for a
  manual sort, folders/notes interleave per `manualOrder` with unlisted items at
  the bottom. `getView(path)` is threaded through so each folder orders its own
  children. `reorderKeys()` computes a new `manualOrder` from a drag.
- **`NavTree.tsx`** — folder rows split into a chevron (expand) + label (opens the
  table). Drag-to-reorder shows before/after indicators on a row's top/bottom
  quarters and drops *into* a folder from its middle; reordering sets the folder to
  manual order. Pin toggles: folders via the store, notes via `onToggleNotePin`
  (read+save `meta.pinned`, like the editor's pin button). `FolderSortMenu.tsx` is
  the per-folder sort picker.

## Folder table (`src/foldertable/`)

- **`FolderTableView.tsx`** — virtualized (`@tanstack/react-virtual`), sticky Name
  column + breadcrumbs. Rows come from the tree node's children (summaries already
  carry `created`/`size`/`properties`). New `AppView "folder"` + `openFolder(path)`
  in `viewState`; rendered code-split like the graph/calendar/kanban views.
  - **Pinned rows** get a tinted background, a pin icon, and a divider under the
    last pinned row so the "pinned float to the top" grouping reads at a glance.
  - **Column resize**: drag a header's right edge; widths persist to
    `FolderView.columnWidths` (keyed by `columnKeyStr`) with a per-type default.
  - The header and body are **separate scroll containers**; the header mirrors the
    body's `scrollLeft` (JS) so columns stay aligned once they overflow sideways,
    while the body still scrolls vertically on its own.
- **`ordering.ts`** — table row ordering (pinned → folders-above-notes → multi-level
  `tableSort` → Name tiebreak). `select` sorts by the option's position in its
  definition, not alphabetically; empty values sort last **regardless of
  direction** (presence is checked outside the asc/desc flip). All column
  comparisons are guaranteed finite — a `NaN` comparator silently corrupts
  `Array.sort` into a garbage order (this caused a "2 1 3" descending-number bug).
- **`SortMenu.tsx`** — the multi-level sort panel (stack several criteria, e.g.
  "modified asc, then a custom property desc"; reorder/flip/remove levels).
  Header clicks flip a column's direction in place (preserving other levels).
- **`useFolderSchema.ts`** — schema mutations bound to one folder (add/remove
  column, create/edit/delete property, add option, set sort), keeping invariants
  (hiding/deleting a column also drops it from the sort).
- **`PropertyCell.tsx`** — per-type inline editors; select/multi-select support
  quick-add of new options (reusing `TAG_PALETTE`). `ColumnHeader.tsx` (sort +
  hide/edit/delete menu), `AddColumnPopover.tsx` (built-in or new property),
  `PropertyEditor.tsx` (rename + manage select options; type is fixed post-create).

## Gotchas

- Property **values** persist per note (survive a move, dormant if the target
  folder lacks that property id); **definitions** are per folder. Moving a note
  between folders swaps which columns apply, by design.
- A note's `size` is captured at write/index time and self-heals on the next
  save or external-change reconcile — it's derived, never a source of truth.
