# Tundra — Phase 2 Master Build Document

Phase 2 = **Rich content & structure**: tables + image/video/attachment embeds, `[[links]]` + backlinks, the graph view, quick notes, and the home dashboard. This is the single source for building it.

## How to use this file (for Claude Code)

- Work **one step at a time, in order** (Step 1 → Step 6). Do not skip ahead or combine steps.
- The **Preamble** below applies to every step. **All Phase 1 invariants still hold** (strict layering — only `src/services/` imports `@tauri-apps/api`; done-bar = code + tests + a demonstrated acceptance check; specta pinned at `2.0.0-rc.25`; atomic writes via temp+fsync+rename; the self-write registry; `.vault/cache/` is derived/rebuildable). Where the preamble conflicts with your own judgment, the preamble wins; surface any new fork rather than guessing.
- **Read the current code first and match its conventions.** Phase 1 is built: `tundra-core` has `document` / `vault` / `error` / `index` / `watcher`; the vault holds an in-memory `id → path` index, a self-write registry, `reconcile_path`, and a `ChangeEvent` enum; commands use `#[tauri::command] #[specta::specta]` + `current(&state)` and are registered in `collect_commands!`; typed events go through `collect_events!` (`TreeChanged`, `NoteChangedExternally`); the frontend has `services` namespaces, a `zustand` view store (`useViewState`), a `nav` tree, a `search` palette, and a `NoteEditor` built on `useCreateBlockNote` + `BlockNoteView` from `@blocknote/shadcn`, with an `import_icon` + `convertFileSrc` pattern for vault-local files.
- Each step ends with a **done-bar**. Meet it before moving on. After Step 6, run the **Phase 2 verification pass** at the end.
- Do **not** start Phase 3 work (calendar, backup, spellcheck) or Phase 4/5 (sync, AI).

---

# PREAMBLE — Phase 2 locked decisions (authoritative; additive to the Phase 1 preamble)

## Links — hybrid `[[Title]]` authoring, UUID-backed storage

- A link is a **custom BlockNote inline content node** that stores the target note's **UUID** plus a display **label** (the title captured at insertion). `[[` is only the authoring trigger — the stored form is the inline node carrying the id, not literal `[[Title]]` text.
- **Identity is the UUID**, so links survive rename and move with **no repair step** — this honors the locked "links survive rename" principle directly. There is no title→id resolution, no duplicate-title ambiguity, and no repair-on-rename write amplification.
- **Live labels.** Render a link's display text from the target's *current* title (resolved by id via the index), so a rename updates every link's label automatically. The stored label is a fallback used only when the target is missing (deleted) and for Markdown export.
- **Broken links.** If the stored id no longer resolves to a note (target deleted), render the link distinctly using the stored label and exclude it from graph edges. Do not crash.
- Every link node carries a stable inline id like all block content (CRDT-ready).
- **Scope:** `[[note links]]` only for Phase 2. `@-mentions` reuse the same node/parser later — do not build them now.
- Backlinks and graph edges are **derived data**: the `links` module walks the block tree, reads each link node's `noteId` directly, and caches the node/edge set under `.vault/cache/graph/` (rebuildable, never a source of truth). Recompute a note's links on save and on the step-8 external-change events.

## Attachments — content-addressed store

- Imported images/videos/files are **copied into the vault** under `attachments/images|videos|files/`, named by a **content hash** (use `blake3`), sharded into subdirectories by the first bytes of the hash (e.g. `attachments/images/ab/abcdef….png`). Identical content dedupes automatically; references are stable and collision-proof.
- The block that embeds an attachment stores the **vault-relative hashed path** plus the **original filename** (for display/download). FS work goes through Rust — generalize the existing `import_icon` into an `import_attachment(src_path, kind)` that returns the vault-relative path; never write attachments from the frontend.
- Display uses Tauri's asset protocol (`convertFileSrc`) via the `services` layer, exactly like note icons.

## Graph — notes as nodes, `[[links]]` as edges

- Nodes = notes; edges = resolved directed links between them (global graph). Render with **`sigma` + `graphology`** (locked). Run the **ForceAtlas2 layout in a Web Worker** (`graphology-layout-forceatlas2/worker`) — layout, not rendering, is the bottleneck; never block the UI thread.
- Nodes are **dots + text labels, not per-note icons** (rendering images per node in WebGL is out of scope). Drive sigma **imperatively inside a `useEffect`/ref**, not via a React wrapper. Support pan/zoom, hover-highlight neighbors, and click-to-open. Persist view settings (zoom, filters, pinned positions) to `.vault/config/graph-view.json` through Rust.

## Quick notes — a `meta.quickNote` flag

- Quick notes are ordinary notes with `meta.quickNote = true`. They are created into a default location and surfaced in a dedicated Quick Notes panel with a trimmed editor config (fast capture). They remain fully searchable and linkable — no separate storage concept.

## Home dashboard — configurable widgets

- Build a dashboard with **user-selectable, arrangeable widgets** (add/remove/reorder). Ship at least: pinned notes (`meta.pinned`), recent notes (by `modified`), and quick-capture. The dashboard layout/config is vault-scoped UI state persisted to `.vault/config/home.json` **through Rust** (never `localStorage`). Home is the default landing view.

## Shell

- Introduce a top-level **view switcher** (editor / graph / quick notes / home) in the app shell, driven by `zustand` view state (extend `useViewState`). Views mount lazily; the editor/nav remain the note-editing view.

## Out of scope for Phase 2

Calendar, backup, spellcheck → Phase 3. CRDT/sync → Phase 4. AI → Phase 5. Keep every block's stable `id`; keep `.vault/cache/` derived.

---

# BUILD STEPS

---

## Step 1 — Attachments: content-addressed store + rich embed blocks + tables

```text
The Preamble above is authoritative. Phase 2, step 1. Read the current vault.rs (the import_icon pattern) and NoteEditor.tsx first, and match them.

Rust (tundra-core):
1. Add content-addressed attachment import. Generalize the import_icon approach into import_attachment(src_path, kind) where kind ∈ {image, video, file}: hash the file bytes with blake3, copy it to attachments/<kind>/<aa>/<hash>.<ext> (sharded by the first 2 hex chars), and return the vault-relative path. Identical content must dedupe (same hash → same path, copy skipped). Add blake3 as a core dependency.
2. Expose an import_attachment command (collect_commands!) + a services wrapper, and a services helper that turns a vault-relative attachment path into a displayable URL via convertFileSrc (like note icons).

Editor (frontend):
3. Enable BlockNote's built-in table block.
4. Wire BlockNote's file upload path so embedding an image/video/file routes through import_attachment and stores the returned vault-relative hashed path + the original filename in the block; render via the convertFileSrc helper. Use BlockNote's built-in image block where possible; add custom video/file blocks only as needed. No attachment bytes are ever written from the frontend.

Tests / verification: import_attachment unit tests — same content dedupes to one file, different content gets distinct sharded paths, the returned path round-trips to a real file; embedding an image copies it under attachments/images/<shard>/ and renders in the editor; a table can be created and persists across reload. Layering check passes.

Done-bar: attachments import content-addressed through Rust, embeds + tables work and survive restart, bindings regenerate, app builds (cargo test + tsc + vite build). Show changed files and test output.
```

---

## Step 2 — `links` module (Rust): parse id-backed link nodes, backlinks, graph data

```text
The Preamble above is authoritative. Phase 2, step 2. New core module `links`. Reuse the vault's in-memory index; derive everything, store no source-of-truth in cache.

1. Parsing: walk a note's block tree (the opaque content, same traversal search uses) and extract the custom inline LINK NODES, reading each node's stored `noteId` directly. No title matching, no title→id map, no disambiguation — identity is the id.
2. Backlinks: for any note id, compute the set of notes containing a link node that targets it. Provide backlinks(id) -> [NoteSummary].
3. Graph data: produce the node/edge set (directed) from link nodes whose target id resolves to an existing note; drop edges to missing ids (broken links are not edges). Cache under .vault/cache/graph/ (rebuildable). Provide graph_data() and a rebuild.
4. Label resolution: provide a way for the frontend to resolve a set of note ids to their CURRENT titles (for live link labels) — a small resolve_titles(ids) command, or reuse existing summaries if that already covers it.
5. NO repair-on-rename. Links are id-based and survive rename automatically — do NOT rewrite referencing notes on rename. Recompute a note's own links on save and on external-change events so backlinks/graph stay current.
6. Commands + services wrappers for backlinks(id), graph_data(), and title resolution; register in collect_commands!.

Tests: parse link nodes from representative trees (incl. a link to a since-deleted id → broken, excluded from edges); backlinks correct; RENAME a linked note and confirm referencing notes are NOT rewritten and the link still resolves to it by id; graph_data returns the expected nodes/edges; rebuild reconstructs from notes.

Done-bar: cargo test green; links derived from id-backed nodes + cached; no rename rewrites; bindings regenerate. Show changed files and test output.
```

---

## Step 3 — Links in the editor: custom inline link node, `[[` autocomplete, backlinks panel

```text
The Preamble above is authoritative. Phase 2, step 3. Frontend only, on top of step 2's data. Data through services; never import @tauri-apps/api outside src/services/.

1. Schema: define a custom BlockNote INLINE CONTENT spec for a note link (e.g. createReactInlineContentSpec) storing { noteId, label }. Register it in the editor's BlockNoteSchema, and apply the SAME schema everywhere the editor is created (NoteEditor and the trimmed quick-note editor in step 5) so link nodes render consistently.
2. Authoring: typing `[[` opens a suggestion menu listing notes by title (from services); selecting inserts the link node with { noteId: <target id>, label: <target's current title> }. Keyboard-driven.
3. Rendering: the node renders as a clickable link whose text is the target's LIVE current title (resolve id→title via services, falling back to the stored label); clicking opens that note by id (set the open note id in the view store). If the id no longer resolves (deleted), render it distinctly (muted/dashed) using the stored label.
4. Export: give the inline node a Markdown/HTML serialization (e.g. `[[Label]]`) so export stays sensible.
5. Backlinks panel: below or beside the editor, show incoming links for the open note (services.backlinks(id)) — each opens that note.

Tests / verification: the `[[` menu filters by title and inserts an id-backed link node; the link shows the target's current title and opens it; RENAMING the target updates the link's displayed label live with no file rewrite; a link to a deleted note renders as broken; the backlinks panel lists the correct incoming notes and navigates. Layering check passes.

Done-bar: id-backed link authoring/navigation + live labels + backlinks panel work through services, app builds. Show changed files and verification output.
```

---

## Step 4 — Graph view + shell view-switcher

```text
The Preamble above is authoritative. Phase 2, step 4. Establish the top-level view switcher, then build the graph. Data through services only.

1. Shell: add a view switcher (editor / graph / quick notes / home) driven by the zustand view store (extend useViewState). Views mount lazily; the editor+nav stay the note view. (Quick notes and home are wired in steps 5–6; leave placeholders.)
2. Graph: render services.graph_data() with sigma + graphology, driven imperatively in a useEffect/ref (not a React wrapper). Run ForceAtlas2 in a Web Worker (graphology-layout-forceatlas2/worker) so the UI never blocks. Nodes are dots + labels (no per-note icons). Support pan/zoom, hover-highlight of a node's neighbors, and click-to-open (sets the open note id and switches to the editor view).
3. Persist view settings (zoom/filters/pinned positions) to .vault/config/graph-view.json through Rust (add a small command + service if one doesn't exist).

Tests / verification: with a seeded, linked vault the graph renders and stays interactive (layout runs off the main thread — confirm no UI freeze on a few-thousand-node graph); clicking a node opens that note; hover highlights neighbors; view settings persist across reload. Layering check passes.

Done-bar: graph renders from real link data with worker layout, view switcher works, settings persist, app builds. Show changed files and verification output.
```

---

## Step 5 — Quick notes (`meta.quickNote` flag + panel)

```text
The Preamble above is authoritative. Phase 2, step 5. Small. Reuse the existing note model and editor.

1. Model: ensure NoteMeta carries a quickNote: bool flag (default false), serialized in the note JSON. A create_quick_note path sets it true and creates the note into a default location.
2. UI: a Quick Notes panel/view (wired into the step-4 switcher) listing quick notes (filter by meta.quickNote) with a trimmed editor config for fast capture (no heavy slash-menu blocks). New-quick-note action is one keystroke/click.
3. Quick notes remain normal notes — searchable, linkable, visible in search/graph like any other.

Tests / verification: creating a quick note sets meta.quickNote and it appears in the panel; it is findable in search and can be linked to/from; a normal note is not shown in the panel. Layering check passes.

Done-bar: quick notes create/list/edit via the flag, remain normal notes, app builds. Show changed files and verification output.
```

---

## Step 6 — Home dashboard (configurable widgets)

```text
The Preamble above is authoritative. Phase 2, step 6 — the last build step. Build the landing dashboard with user-configurable widgets. Data through services; layout persisted through Rust.

1. Widgets: implement at least Pinned (meta.pinned), Recent (by modified), and Quick capture. Each widget is a self-contained component reading its data via services.
2. Configuration: the user can add, remove, and reorder widgets. Persist the dashboard layout/config to .vault/config/home.json THROUGH RUST (add a command + service to read/write it) — never localStorage. Load it on open.
3. Make Home the default landing view in the shell switcher.

Tests / verification: the dashboard shows pinned + recent + quick-capture with correct data; adding/removing/reordering a widget persists across reload (config written to .vault/config/home.json via Rust); Home is the landing view. Layering check passes.

Done-bar: configurable dashboard works and persists through Rust, Home is the landing view, app builds. Show changed files and verification output.
```

---

# PHASE 2 VERIFICATION PASS (after Step 6)

- Embed an image, a video, and a file — all copied content-addressed under `attachments/`, deduping on re-import, and rendering; tables work; everything survives restart.
- Author `[[links]]` via the `[[` menu; links navigate by id; a link to a deleted note renders as broken; the backlinks panel is correct.
- **Rename a linked note → every link still resolves to it by id and its label updates live, with NO file rewrites** (id-backed link nodes).
- The graph renders the real link structure, stays interactive on a few-thousand-node seeded vault (worker layout — no UI freeze), and click-to-open works.
- Quick notes create/list/edit via `meta.quickNote` and remain normal (searchable, linkable) notes.
- The home dashboard shows pinned/recent/quick-capture, widgets can be added/removed/reordered, and the layout persists across restart via `.vault/config/home.json`.
- All Phase 1 guarantees still hold (persistence, reconciliation, search, ~50k responsiveness).

Clear that bar and Phase 2 is done. Next is **Phase 3** (calendar + note-date linking, backup-to-archive, multilingual spellcheck + custom dictionary, settings polish).
