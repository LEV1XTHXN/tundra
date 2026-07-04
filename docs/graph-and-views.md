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
  images per node in WebGL is out of scope). Hover highlights a node + its
  neighbors and fades the rest (node/edge reducers + `enterNode`/`leaveNode`).
  Click opens the note (`openNote`, which also switches to the editor view).

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

The graph persists its camera (zoom/pan) to `graph-view.json`, debounced. This is
the same store Home's `home.json` will use in step 6.

## Atomic-write test portability (fixed here)

`vault::tests::interrupted_write_leaves_no_tmp_and_preserves_prior_version` used
to force the write to fail by marking the target *file* read-only. That doesn't
fail on ext4/POSIX: a rename/replace only needs write permission on the parent
*directory*, so the replace succeeded and the note changed — the test tripped on
this dev box. It now marks the note's parent **directory** read-only instead, so
the atomic-write temp file can't be created and the write errors before it can
touch the existing file. Portable, and it still proves the guarantee (no `.tmp`
left behind, prior version intact).

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
