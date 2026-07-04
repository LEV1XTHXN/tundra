# Graph view, the shell view switcher & vault config

Phase 2 step 4. Three things landed together: a top-level view switcher in the
shell, the graph view, and a generic vault-scoped config store (used first by the
graph, then by Home in step 6).

## View switcher

`useViewState` (`src/store/viewState.ts`) now carries `view: AppView`
(`"editor" | "graph" | "quicknotes" | "home"`) plus `setView`, and a convenience
`openNote(id)` that sets the open note **and** switches to the editor view. Every
"navigate to a note" entry point (nav click, search result, new note, graph
click) goes through `openNote`, so you always land on the note you asked for
regardless of which view you were in.

The switcher is a segmented control at the top of the sidebar (`App.tsx`). The
active view's content renders in `.main-pane`; only the active view is mounted.
The graph view is additionally **code-split** via `React.lazy` so sigma +
graphology (WebGL, ~180 kB) only load when the graph is first opened — confirm
with the separate `GraphView-*.js` chunk in `vite build` output.

Default view is `editor` for now; step 6 flips the default to `home`.

## Graph view (`src/graph/GraphView.tsx`)

- Data is `services.links.graph()` — the Rust `links` module derives nodes/edges
  from id-backed link nodes (see step 2). React never computes graph data.
- **Imperative, not a React wrapper.** sigma owns a WebGL canvas + render loop;
  it's created inside a `useEffect` against a ref and `kill()`ed on cleanup.
  Don't wrap it in a component library — the reconciler must stay out of it.
- **Layout runs in a Web Worker** (`graphology-layout-forceatlas2/worker`).
  Layout, not rendering, is the bottleneck; a few-thousand-node vault must not
  freeze the UI thread. The worker is created from a blob by the library itself —
  no separate worker file, no Vite worker config. It's `stop()`ped after it
  settles (bounded by node count) so it doesn't pin a CPU core, and `kill()`ed on
  unmount.
- Nodes are **dots + labels**, sized by degree; no per-note icons (rendering
  images per node in WebGL needs sigma's node-image program — a dep off the
  allow-list — so it's a deferred task, not wired). Hover highlights a node + its
  neighbors and fades the rest (node/edge reducers + `enterNode`/`leaveNode`).
  Click opens the note (`openNote`, which also switches to the editor view).
- **Node dragging** is hand-rolled (sigma has none): `downNode` starts it,
  the mouse captor's `mousemovebody` + `preventSigmaDefault()` moves the node and
  suppresses the camera pan, `mouseup` ends it. A quick click still opens the note;
  a `dragMoved` flag suppresses that open at the end of a real drag. While dragging,
  a small spring relaxation runs on `requestAnimationFrame` so connected notes
  trail along with soft physics (FA2 can't drive this — its worker owns an internal
  position matrix and ignores graph edits mid-run). **Perf gotcha:** write all node
  positions in ONE `graph.updateEachNodeAttributes` per frame — per-node writes each
  emit a graphology event and make sigma re-react N times a frame (visible jitter).
- **Labels sit centered directly under the node** (not sigma's default
  upper-right). Custom `defaultDrawNodeLabel` + `defaultDrawNodeHover` in
  `nodeLabel.ts` (their function types are derived from sigma's own constructor
  settings so no subpath type imports are needed). **Gotcha:** they set
  `context.textAlign = "center"` and must restore it to `"left"` — edge labels
  center themselves manually and assume a left-aligned canvas.
- **Info & settings panel** (`GraphInfoPanel.tsx`, Alt+I or the corner button):
  live stats (notes / links / leaves) and display settings — show names
  (`renderLabels`), node size (a multiplier over each node's stored `baseSize`),
  and line length. The panel is React and reaches the live sigma/graph through
  refs; it never rebuilds them. Open/closed is `useViewState.graphInspectorOpen`;
  Alt+I is dispatched in `App.tsx` to whichever panel fits the view (note
  inspector in the editor, this one in the graph).
- **Line length gotcha:** `autoRescale` (on by default) refits the node
  bounding-box to the viewport every frame, so spreading nodes via the layout is
  normalized away and looks unchanged — the first attempt (FA2 `scalingRatio`) did
  nothing on screen for this reason. The working lever is `setCustomBBox`: a box
  *smaller* than the real extent (`extent / spread`) maps the graph to more than
  the viewport, so edges render longer while screen-referenced node sizes stay
  put. `setCustomBBox` only schedules a render, so call `refresh()` after to
  recompute the normalization. Applied on the slider and once the initial layout
  settles (`spread = 1` clears the custom box, back to auto-fit).

## Vault-scoped config (`.vault/config/*.json`)

Vault UI state that must persist and may sync lives under `.vault/config/`, owned
by Rust — **never** `localStorage` (CLAUDE.md §4 blacklist, §5.2).

- Core: `Vault::read_config(name)` / `write_config(name, contents)` in
  `vault.rs`. Writes are atomic (temp + rename), same discipline as note writes.
  `name` is validated to a bare filename (no `/`, `\`, `..`) so a config name
  crossing IPC can't traverse out of the config dir.
- Commands: `read_vault_config` / `write_vault_config`.
- Service: `services.config.read<T>(name)` / `write(name, value)` handle
  JSON (de)serialization; a corrupt/missing file reads as `null` (it's
  rebuildable UI state, so callers fall back to defaults instead of throwing).

The graph persists its camera (zoom/pan) **and** its panel display settings
(`showLabels`, `nodeSizeScale`, `edgeLength`) to `graph-view.json`, debounced —
all merged into one `settingsRef` object so writing one field never clobbers
another. This is the same store Home's `home.json` will use in step 6.

## Atomic-write test portability (fixed here)

`vault::tests::interrupted_write_leaves_no_tmp_and_preserves_prior_version` used
to force the write to fail by marking the target *file* read-only. That doesn't
fail on ext4/POSIX: a rename/replace only needs write permission on the parent
*directory*, so the replace succeeded and the note changed — the test tripped on
this dev box. It now marks the note's parent **directory** read-only instead, so
the atomic-write temp file can't be created and the write errors before it can
touch the existing file. Portable, and it still proves the guarantee (no `.tmp`
left behind, prior version intact).

## Quick notes — a single scratchpad

Quick notes (Phase 2 step 5) are **one** always-there scratchpad for fast idea
capture — **not** vault notes. The single document lives in its own file at the
vault root (`quicknote.json`, outside `notes/`), so it never appears in nav,
search, links, or the graph; the note index doesn't know about it. Rust:
`Vault::read_quick_note` (returns a fresh empty note until first save) /
`save_quick_note` (atomic write, no index update) → commands `read_quick_note` /
`save_quick_note`. It reuses the `Note` block model but is deliberately kept out
of the index.

Frontend `QuickNoteView` (`src/quicknotes/`) is a **trimmed** editor
(`quickNoteSchema`: basic text, all list kinds, attachments — but **no** custom
`noteLink` inline content, so `[[` does nothing, and no `heading`/`table`),
autosaved to `services.quickNote`. No title/icon/backlinks/inspector — write fast,
organize into real notes later. The idea: dump thoughts here without spawning
notes, then move the keepers into the vault.

## Home dashboard (configurable widgets)

Home (Phase 2 step 6) is the **default landing view** (`useViewState.view` starts
`"home"`). `src/home/` is a dashboard of user-configurable widgets — **Pinned**
(`meta.pinned`), **Recent** (by `modified`), **Quick capture** (appends to the
quick-note scratchpad). Widgets can be added, removed, and reordered (up/down);
the ordered layout is vault-scoped UI state persisted to `.vault/config/home.json`
**through Rust** via the step-4 `services.config` (`read`/`write`), never
localStorage. Each widget is self-contained and reads its data via `services`.

Pinning is surfaced by mirroring `NoteMeta::pinned` onto `NoteSummary` (`pinned`,
populated in every summary site) so the Pinned widget filters without re-reading
files; pin/unpin is the pin button in the note editor header (a normal
`save_note` with `meta.pinned` flipped).

## Note metadata inspector

`src/inspector/NoteInspector.tsx` is a collapsible right-hand drawer for note
*metadata* (as opposed to content): word/character counts, outgoing-link count,
created/modified dates, and the **backlinks list** (moved here out of the editor
body — it used to sit below the note, buried under the editor's `60vh`
scroll-past-end padding). Toggled from a floating button in the editor view;
open/closed state is UI-only (`useViewState.inspectorOpen`, defaults closed).

The drawer is absolutely positioned inside `.main-pane` and slid off the right
edge (`transform: translateX(100%)`) when closed, so it costs no layout space
until opened; when open, `.main-pane.inspector-open` shifts the editor content
left of the 300px drawer. Stats come from `noteStats()` (`src/editor/noteStats.ts`,
a pure block-tree walk); it fetches only while open. Add new metadata fields as
rows in the "Details" `<dl>` or as new `<section>`s — it's built to grow.

## Typed `[[Title]]` links

The `[[` suggestion menu is the primary way to author links, but a user can also
type or paste the whole `[[Title]]` literally — and the two-char `[[` trigger is
unreliable on WebKitGTK (same reason input rules were dropped for web links).
`src/editor/typedLinks.ts` scans the cursor block's inline content on change and
upgrades any completed `[[Title]]` whose title resolves to an existing note into
an id-backed link node (a one-time title→id capture, like the menu — NOT
read-time resolution; links are still stored/derived by UUID). Unresolved titles
stay literal text. Wired in `NoteEditor.tsx`'s `onChange`, guarded against the
re-entrant change `updateBlock` fires.
