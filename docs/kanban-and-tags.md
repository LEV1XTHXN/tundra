# Kanban boards & note tags (Phase 3+)

Two coupled features added after the Phase 3 productivity layer: a **Kanban view**
(user-curated boards of notes, like the calendar/quick-notes it's a *view* onto
the vault, not a block inside a note) and a first-class **tag system** on notes.

## Data model

- **Tags** live on the note: `NoteMeta::tags: Vec<String>` (already existed) and are
  now **mirrored into `NoteSummary::tags` + the in-memory index**, exactly like
  `pinned`/`dates`, so tag-driven listings never re-read note files. Normalized
  (trim, drop blanks, dedup) by `vault::normalize_tags`.
- **Boards** persist to `.vault/config/kanban.json` (content — backed up, MAY sync;
  **not** under the rebuildable `.vault/cache/`), managed by `kanban::KanbanStore`
  held in `AppState` alongside the calendar store. Shape:
  `KanbanBoard { id, name, columns: [ KanbanColumn { id, name, tag: Option<String>, note_ids: Vec<String> } ] }`.
- Membership is **explicit**: a board only shows notes the user placed on it. A
  note appears **at most once per board** (adding it to a second column moves it).
- A **row's name is the tag it assigns**: the column editor has a "tag notes with
  this row's name" checkbox (on by default) that sets `tag = name`; leaving it off
  makes a plain tag-free row. New boards seed two **untagged bookend** rows —
  `Open` (leftmost) and `Closed` (rightmost).
- **Bookends + reorder**: the first and last columns are the Open/Closed bookends
  (positional, not a stored flag) — not draggable. New columns are inserted just
  before the last bookend (add-then-`move_column` in `KanbanView.submitColumnDialog`),
  so every user row lives between Open and Closed. Middle rows have a drag handle
  and reorder via native DnD (`kanban_move_column`), clamped to stay inside the
  bookends; a left-edge bar marks the insertion point.
- **Tag colors** are per-vault presentation config in `.vault/config/tag-colors.json`
  (a `tag → hex` map), written via the frontend `config` passthrough — no new Rust
  command. Owned by the `useTagColors` zustand store (`src/store/tagColors.ts`,
  loaded on vault open); chips render in the tag's color in Kanban cards, the
  column dot, and the inspector. Colors are set from the column editor (for that
  row's tag) or per-tag in the inspector.
- Card note ids are stored raw; a card whose note was deleted is a dangling id the
  frontend simply drops when it resolves cards to titles (via `list_notes`). The
  board file is not eagerly pruned.

## Tag ↔ column automation (the core rule)

A column may carry an optional **tag**. `KanbanStore::place_card` (shared by
`add_card`/`move_card`) computes a `TagDelta`:

- Drop a note into a column with tag `T` → the note **gains** `T`.
- Move it out to another column → it **loses** the source column's tag, **gains**
  the destination's. Equal from/to tags collapse to a no-op (`TagDelta::between`).
- Remove a note from the board → it **loses** the column's tag.

The destination tag is **prepended** (`vault::prepend_note_tag`), not appended, so
a note's Kanban board tag always sorts *before* its other tags in the tag list —
including when a card is moved between columns/boards, which strips the old board
tag and prepends the new one. The board mutation is persisted **before** the tag
change is applied to the note, so a crash can't leave a tag change without its
placement. Changing a column's tag
does **not** retro-tag cards already in it (deliberately simple; a bulk re-tag can
come later). Deleting a column/board leaves notes' tags untouched.

## Tag search (`#tag` in global search)

The global search palette (F2, `src/search/SearchPalette.tsx`) has a **tag mode**:
a query starting with `#` searches **only** the note's tag set instead of full
text. So `#bio` surfaces notes *tagged* `biology`, whereas a plain `biology`
search also returns any note that merely mentions the word.

- **Matching lives in the core**, reusing the search index — no new field or
  reindex. The `tags` field was already indexed (`TEXT | STORED`) for full-text.
  `SearchIndex::search_by_tag` (`index.rs`) prefix-matches each query word
  against `tags` with a `"word.*"` `RegexQuery`, and requires **every** word to
  match (`Occur::Must`) — so `#machine learning` won't match a note tagged only
  `machine`. Prefix + per-word behavior mirrors plain `search`.
- The result **snippet is the note's full tag set** (`#a #b`, read back from the
  STORED `tags` values) so the palette shows why a note matched.
- **Frontend only routes**: a leading `#` sends the rest to `search.byTag`
  (`src/services/index.ts`) instead of `search.query`; a bare `#` shows nothing
  until a tag is typed. Command: `search_by_tag` in `commands.rs`, registered in
  `lib.rs`, bindings regenerated.
- **Reindex on tag change (gotcha):** `vault.save_note` refreshes only the
  *in-memory summary* index, not the Tantivy search index — that's the command
  layer's job via `reindex_after_write`. So every tag mutation reindexes the
  note (`reindex_tags` helper): the three `*_note_tag(s)` commands **and** the
  Kanban `add`/`move`/`remove_card` commands (which change tags via column tag
  deltas). Without this, a newly added tag isn't findable by `#tag` until the
  next vault-open `catch_up`. Kanban reindex is best-effort (a board may hold a
  dangling note id).

## Layering (unchanged rules)

All logic is in `tundra-core`; the Tauri layer (`commands.rs`) only resolves the
open vault + store and delegates. Every mutation command returns the **full board
list** (`Vec<KanbanBoard>`) so the frontend replaces state in one round trip — no
client-side reconciliation. Commands: `set_note_tags`/`add_note_tag`/
`remove_note_tag` and `kanban_*` (boards/columns/cards), registered in
`src-tauri/src/lib.rs`, surfaced by the `tags`/`kanban` gateways in
`src/services/index.ts`.

## Frontend

- `src/kanban/KanbanView.tsx` — lazy-loaded view (own chunk). Board **tabs**
  (create/rename/delete via a popover menu), columns with add/edit(name+tag)/delete,
  cards with native HTML5 drag-and-drop (reorder within + move between columns),
  an "Add note" **CommandDialog** picker (excludes notes already on the board),
  and note-tag chips **below the card title** (they wrap and grow the card).
  Wired into the shell switcher in `App.tsx` (`AppView` gained `"kanban"`).
- **Collapsible columns**: each column can collapse to a thin strip with its name
  turned 90° (`writing-mode: vertical-rl`), hiding its cards. The collapsed set is
  persisted per-vault in `.vault/config/kanban-view.json` (`{ collapsed: string[] }`,
  presentation config) via the frontend `config` passthrough.
- `src/inspector/NoteInspector.tsx` — a **Tags** section (chips with remove + an
  add input) so any note's tags are editable outside Kanban. Re-reads the note
  after each edit to reflect the core's normalized set.

## Tests

`kanban.rs` covers persistence/reload (seeded open/closed, untagged),
drop-tags-a-note, move-swaps-the-tag + remove-strips-it, at-most-once-per-board,
and reorder-leaves-tags-alone.
`vault.rs::note_tags_surface_in_summary_and_survive_reopen` covers the mirroring.
`index.rs` covers tag search: tag-field-only + prefix matching (`#bio` →
`biology`, and a note that only *mentions* the word is not a tag hit),
every-word-must-match, and empty-query-returns-nothing.
`commands.rs::tag_mutations_are_searchable_without_a_reopen` drives the tag
commands through the mock runtime and asserts `#tag` search reflects add/set/
remove immediately (the reindex-on-tag-change fix).
GUI itself not launched here (WebKitGTK/headless), consistent with prior phases —
data logic is verified by unit tests + a clean `tsc`/`vite build`.
