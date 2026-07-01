# Tundra Note-Taking App — Master Architecture & Project Specification

A **local-first**, **Notion-style**, **Markdown-aware** desktop note app built for speed and robustness. Notes are structured blocks stored as JSON on the local file system; all data logic lives in Rust; React only renders. The design scales — without rewrites — to self-hosted, conflict-free sync across PC and phone, and later to a locally running AI agent over your notes.

---

## 1. Core ideas

The product vision, consolidated from the original concept and the locked stack decisions.

- **Modular & staged.** Built in coherent stages so systems stay consistent and the codebase scales.
- **Fast & robust above all.** Rich but restrained — no feature bloat. Performance and data safety are the top priorities.
- **Notion-style block editor, Markdown-aware.** Notes are trees of typed blocks (source of truth), with Markdown input shortcuts and Markdown import/export. Non-Markdown blocks (tables, images, videos) are first-class.
- **Local-first, local-only to start.** No cloud. All data on the local file system. The architecture leaves a clean path to self-hosting on your own server later.
- **Vault model.** Notes nest in folders and link to each other. Attachments (images, videos, files) are stored locally in dedicated per-type libraries inside the vault.
- **Per-note icons.** Each note can have an emoji or vector icon (Twemoji — the Twitter/Discord-style set).
- **Graph view.** An Obsidian-style graph of all notes and the links between them.
- **Quick notes.** A dedicated, text-only space stored like a normal note but surfaced separately in the UI.
- **Calendar.** Mark events and time periods; link notes to specific dates and events.
- **Backup.** A settings button snapshots the entire vault into an archive, stored on the computer *separately* from the vault.
- **Multi-device, conflict-free (future).** When self-hosting arrives, the same vault works on phone and PC, using a **CRDT** to merge edits without overwriting.
- **Multilingual spellcheck.** With the ability to add custom words and terms.
- **Local AI agent (future).** Ask it to find information across notes, create notes, or add calendar events — potentially with voice control. Runs locally.
- **Home dashboard.** Links to important and recent notes, plus user-selectable widgets.

---

## 2. Architectural principles

**One Rust core, thin front doors.** All domain logic, storage, indexing, and (later) sync live in a platform-agnostic Rust core. The desktop app calls it in-process via Tauri commands today; a future sync server and mobile app reuse the *same* crate. This is what makes "same vault on phone and PC later" a packaging change, not a rewrite.

**Strict layering (non-negotiable).**

```
┌─────────────────────────────────────────────┐
│  React + TypeScript                          │  UI rendering, screen state, user actions
│  (never touches files or business logic)     │
└───────────────┬─────────────────────────────┘
                │ typed function calls
┌───────────────▼─────────────────────────────┐
│  Service layer (TypeScript)                  │  the ONLY place that imports @tauri-apps/api
│  wraps every command; exposes typed API      │
└───────────────┬─────────────────────────────┘
                │ Tauri IPC (invoke)
┌───────────────▼─────────────────────────────┐
│  Tauri v2 (bridge)                           │  window, IPC, OS access — no business logic
└───────────────┬─────────────────────────────┘
                │ Rust command handlers
┌───────────────▼─────────────────────────────┐
│  Rust core                                   │  ALL data: read/write, model, index, rules
└───────────────┬─────────────────────────────┘
                │
┌───────────────▼─────────────────────────────┐
│  Local file system (JSON + attachments)      │
└─────────────────────────────────────────────┘
```

- **React** is responsible only for rendering, UI, screen state, and handling user actions. It must **not** read files, save data, or hold business logic.
- **Tauri** only connects React and Rust and exposes system functions. No logic.
- **Rust** owns all data and all rules.
- Communication is **Tauri IPC only** — never localhost HTTP.

**Local-first.** The app is fully functional with no network. Sync is an *additive* layer introduced later, not a dependency.

---

## 3. Technology stack

| Layer | Choice | Notes |
| --- | --- | --- |
| UI framework | **React + TypeScript** | Chosen over Solid: the editor (ProseMirror) and graph (canvas/WebGL) bypass framework rendering anyway, and React's ecosystem (BlockNote, graph libs) is the real leverage. |
| Build tool | **Vite** | Fast dev server + bundling for the Tauri front end. |
| Desktop shell | **Tauri v2** | Tiny binaries, low memory, native Rust integration, real mobile path for Phase 4. |
| Core / backend | **Rust** | All data logic. Compiled into the Tauri app; reused by future server/mobile. |
| Block editor | **BlockNote** (on TipTap/ProseMirror) | Notion-style blocks, slash menu, drag-drop, Markdown I/O out of the box. |
| Note storage | **JSON files** on local FS | One JSON document per note (block tree). Human-inspectable, robust, git-friendly. |
| Full-text search | **Tantivy** (Rust) | Local search index (derived/cacheable). |
| CRDT (Phase 4) | **Yjs / `yrs`** | Pairs natively with BlockNote; `yrs` is the Rust port for the core. |
| Sync server (Phase 4, future) | **Axum** (Rust) | Reuses the core crate. Out of current local-app scope. |

---

## 4. Library allow-list / block-list

### Allowed (whitelist)

**Frontend (npm)**
- `react`, `react-dom`, `typescript`, `vite`
- `@tauri-apps/api` + official `@tauri-apps/plugin-*` (fs, dialog, os, etc.) — **only inside the service layer**
- `@blocknote/core`, `@blocknote/react`, `@blocknote/mantine` (or `@blocknote/shadcn`)
- `zustand` — lightweight UI state (UI state only; never a data store)
- `@tanstack/react-virtual` — virtualization for long lists
- `cmdk` — command palette
- `sigma` + `graphology` (graph view; scales to many nodes) — or `react-force-graph` (simpler, smaller graphs)
- Twemoji assets + an emoji picker (e.g. `emoji-mart` or `frimousse`) — see §5.4
- `date-fns` — date math for the calendar UI
- `yjs` (Phase 4, with BlockNote collaboration)

**Core (Rust crates)**
- `tauri` (v2), `serde`, `serde_json`, `tokio`
- `uuid` — stable note/block IDs
- `notify` — file watching
- `walkdir` — vault traversal
- `tantivy` — full-text search
- `zstd`/`flate2` + `tar` (or `zip`) — backup archives
- `zspell` (pure-Rust, Hunspell-compatible) — spellcheck; or `hunspell-rs` binding
- `chrono` or `time` — calendar/date handling
- `thiserror` + `anyhow` — error handling
- `specta` + `tauri-specta` — generate TypeScript types from Rust (typed IPC)
- Phase 4: `yrs` (CRDT), `axum` (sync server — future/out of local scope)
- Phase 5: `fastembed`/`candle` (embeddings), `hnsw_rs`/`usearch` (vector index), `whisper-rs` (voice)

### Not allowed (blacklist) — for the local app

- **REST API / HTTP servers** between React and Rust. Use Tauri IPC. *(A network transport for Phase 4 self-hosted sync is a separate, explicitly-scoped future concern — see §7.)*
- **Cloud services / cloud SDKs.** Local-only.
- **File access from React.** All FS I/O goes through Rust.
- **Business/data logic in the frontend.** React renders; Rust decides.
- **`localStorage` / `sessionStorage` / IndexedDB** as a data store. App state that must persist is owned by Rust and written to disk.
- **Electron** and its ecosystem (superseded by Tauri).
- **Node.js backend frameworks** (Express, Nest, etc.). There is no JS backend.
- **A second UI framework** (Solid, Vue, Svelte) — React only.
- **Heavy CSS-in-JS runtimes** or large component kits that bloat the bundle — keep the UI lean.

---

## 5. Data & storage model

### 5.1 Vault vs. app data (recommended split — see §8 feedback)

- **Vault** = a **user-chosen folder** (like Obsidian). Portable, backup-able, sync-able. Holds all notes + attachments.
- **App Data Directory** (Tauri) = app-level config only: list of known vaults, last-open vault, window state, global preferences. *Not* note content.

### 5.2 Vault layout

```
MyVault/
  .vault/                      # vault-scoped app data (not user-authored)
    cache/                     # derived, rebuildable — NEVER synced/backed up as source
      search/                  # Tantivy index
      graph/                   # node/edge index derived from notes
    config/                    # vault settings — MAY sync
      graph-view.json          # zoom, groupings, filters, pinned positions
      workspace.json           # panes, last-open note
    dictionaries/              # custom spellcheck words (personal dictionary)
  notes/                       # note documents; folders = real directories (nesting)
    <folder>/<note>.json
  attachments/
    images/                    # every image in the vault
    videos/
    files/
    icons/                     # custom vector/image note icons
```

### 5.3 Note document (JSON, one file per note)

Folders are real directories (portable, browsable). A note's **canonical identity is its UUID**, not its path — so the `links` module can repair links when notes move or rename.

```json
{
  "schemaVersion": 1,
  "id": "0f1c...uuid",
  "title": "Photosynthesis",
  "icon": { "type": "emoji", "value": "1f331" },
  "created": "2026-07-01T10:00:00Z",
  "modified": "2026-07-01T10:12:00Z",
  "meta": { "pinned": false, "tags": ["biology"] },
  "blocks": [
    { "id": "b1", "type": "heading", "props": { "level": 1 }, "content": "..." },
    { "id": "b2", "type": "paragraph", "content": "..." }
  ]
}
```

**CRDT-ready rule:** every block carries a **stable `id`**, and the block tree maps 1:1 onto a Yjs shared structure. In Phases 1–3 the JSON snapshot is the on-disk format (single-user). In Phase 4 the same tree is wrapped in `yrs`; the CRDT state is persisted alongside for multi-device merge, and JSON remains the export format. No data-model rewrite.

---

## 6. Module breakdown

Each module lists its **purpose**, **responsibilities**, **key tech**, and **first phase**.

### 6.1 Rust core modules

#### `vault` — vault lifecycle & file system
- **Purpose:** own the on-disk vault; the only module that touches raw FS.
- **Responsibilities:** open/create/switch vaults; folder tree; atomic reads/writes; attachment library management; file watching for external changes.
- **Tech:** `serde_json`, `tokio`, `notify`, `walkdir`, `uuid`.
- **Phase:** 0–1.

#### `document` — note & block model
- **Purpose:** the canonical note/block data structure and its invariants.
- **Responsibilities:** typed block tree; note metadata; per-note icon; stable IDs; validation; schema versioning/migration. Later: the CRDT-backed representation.
- **Tech:** `serde`, `uuid`; Phase 4: `yrs`.
- **Phase:** 0–1 (CRDT wrapping: 4).

#### `markdown` — Markdown ⇄ blocks
- **Purpose:** import/export and Markdown input handling.
- **Responsibilities:** convert Markdown → block tree and back; round-trip fidelity; paste-as-Markdown.
- **Tech:** a Markdown parser (`comrak` / `pulldown-cmark`), aligned with BlockNote's Markdown semantics.
- **Phase:** 1.

#### `index` — search
- **Purpose:** fast local search over the vault.
- **Responsibilities:** build/update the full-text index on note change; query API; keep the index in `.vault/cache` (rebuildable). Later: vector index for semantic search.
- **Tech:** `tantivy`; Phase 5: `fastembed` + `hnsw_rs`/`usearch`.
- **Phase:** 1 (semantic: 5).

#### `links` — links & graph data
- **Purpose:** resolve inter-note links and produce graph data.
- **Responsibilities:** parse `[[wikilinks]]`/@-mentions; maintain a UUID→path map; compute backlinks; repair links on move/rename; emit the node/edge set for the graph view (cached in `.vault/cache/graph`).
- **Tech:** Rust core; derived data only.
- **Phase:** 2.

#### `calendar` — events & date linking
- **Purpose:** calendar data model.
- **Responsibilities:** events and time periods; link notes ⇄ dates/events; queries by range.
- **Tech:** `chrono`/`time`, `serde_json`.
- **Phase:** 3.

#### `backup` — vault snapshots
- **Purpose:** one-click full-vault archive.
- **Responsibilities:** snapshot the vault into a compressed archive written **outside** the vault; exclude `cache/`; timestamped, verifiable.
- **Tech:** `tar` + `zstd`/`flate2` (or `zip`).
- **Phase:** 3.

#### `spellcheck` — multilingual spelling
- **Purpose:** spellcheck with a user dictionary.
- **Responsibilities:** load multiple language dictionaries; check tokens; add custom words to the personal dictionary (`.vault/config/dictionaries`).
- **Tech:** `zspell` (pure Rust) + Hunspell dictionaries.
- **Phase:** 3.

#### `sync` — CRDT engine & transport (future)
- **Purpose:** conflict-free multi-device replication.
- **Responsibilities:** manage `yrs` documents; compute/apply updates; persist CRDT state; talk to the sync server.
- **Tech:** `yrs`; transport via the future Axum server.
- **Phase:** 4.

#### `agent` — local AI (future)
- **Purpose:** natural-language interaction with the vault.
- **Responsibilities:** RAG over notes; tool-calling (create note, add calendar event); embeddings; optional voice.
- **Tech:** local LLM (Ollama or `candle`), `fastembed`, `whisper-rs`.
- **Phase:** 5.

#### `ipc` — command surface (cross-cutting)
- **Purpose:** the typed boundary between Rust and TypeScript.
- **Responsibilities:** define Tauri commands; serialize/deserialize DTOs; generate matching TS types; uniform error mapping.
- **Tech:** `tauri`, `specta` + `tauri-specta`, `serde`.
- **Phase:** 0 (grows every phase).

### 6.2 Frontend modules (React / TypeScript)

#### `services` — IPC client layer
- **Purpose:** the single gateway to the core; enforces the "React never touches files/logic" rule.
- **Responsibilities:** wrap every Tauri command in a typed async function; consume generated `specta` types; centralize error handling. **Only module allowed to import `@tauri-apps/api`.**
- **Tech:** `@tauri-apps/api`, generated types.
- **Phase:** 0.

#### `shell` — layout & navigation
- **Purpose:** the app frame.
- **Responsibilities:** sidebar, resizable panes, view switching (home/editor/graph/calendar/quick notes), command palette.
- **Tech:** React, `zustand` (view state), `cmdk`.
- **Phase:** 0–1.

#### `editor` — block editor
- **Purpose:** the writing surface.
- **Responsibilities:** BlockNote integration; custom blocks (tables, image/video/attachment embeds); Markdown shortcuts; save via `services` (debounced).
- **Tech:** `@blocknote/react`, `@blocknote/mantine`; Phase 4: BlockNote + `yjs` collaboration.
- **Phase:** 1 (rich blocks: 2).

#### `nav` — note tree
- **Purpose:** browse and organize notes.
- **Responsibilities:** folder tree with nesting; create/rename/delete/move (drag); emoji/icon picker; virtualization for large vaults.
- **Tech:** React, `@tanstack/react-virtual`, emoji picker + Twemoji.
- **Phase:** 1.

#### `graph` — graph view
- **Purpose:** visualize the link graph.
- **Responsibilities:** render nodes/edges from the `links` cache; pan/zoom/filter; click-to-open; persist view settings.
- **Tech:** `sigma` + `graphology` (or `react-force-graph`).
- **Phase:** 2.

#### `quicknotes` — quick notes
- **Purpose:** dedicated fast-capture space.
- **Responsibilities:** minimal text-only surface; stored as normal notes; its own UI slot.
- **Tech:** React + a trimmed editor config.
- **Phase:** 2.

#### `home` — dashboard
- **Purpose:** landing view.
- **Responsibilities:** pinned + recent notes; user-selectable widgets; quick actions.
- **Tech:** React, `zustand`.
- **Phase:** 2.

#### `calendar` — calendar UI
- **Purpose:** view/edit events and note-date links.
- **Responsibilities:** month/week views; create events/periods; link notes to dates.
- **Tech:** React, `date-fns`.
- **Phase:** 3.

#### `search` — search UI
- **Purpose:** find notes fast.
- **Responsibilities:** command-palette + results; full-text now, semantic later.
- **Tech:** React, `cmdk`, `services`.
- **Phase:** 1 (semantic: 5).

#### `settings` — settings UI
- **Purpose:** configuration surface.
- **Responsibilities:** backup button; dictionary management; appearance; (later) sync config.
- **Tech:** React, `services`.
- **Phase:** 1 (grows).

#### `ai` — AI panel (future)
- **Purpose:** chat with your notes.
- **Responsibilities:** conversation UI; surface agent actions; voice input.
- **Tech:** React, `services`.
- **Phase:** 5.

---

## 7. Phased roadmap

**Phase 0 — Foundations.** Monorepo (core crate + Tauri shell + React/Vite). Lock vault format + note schema. Stand up `ipc` + `services` with typed commands. Walking skeleton: choose vault → create note → type → persist JSON → reopen.

**Phase 1 — Core note-taking (daily driver).** `editor` (blocks + Markdown shortcuts), `nav` (folders/nesting/move), per-note icons, local persistence + file watching, full-text search. Document model is CRDT-*ready*.

**Phase 2 — Rich content & structure.** Tables + image/video/attachment embeds (stored in libraries), `[[links]]` + backlinks, graph view, quick notes, home dashboard.

**Phase 3 — Productivity layer.** Calendar + note-date linking, backup-to-archive, multilingual spellcheck + custom dictionary, settings polish.

**Phase 4 — Sync & mobile (local → self-hosted).** Wrap the document model in `yrs`; build the Axum sync server (reuses core); Tauri mobile app (reuses core + most of the frontend); conflict-free multi-device. *This is the only phase that introduces a network transport — the local app's "no HTTP" rule stays intact.*

**Phase 5 — Local AI agent.** Embeddings + vector index (semantic search), RAG chat, tool-calling (create note / calendar event), voice.

---

## 8. Architectural feedback & suggestions

1. **Move the vault out of App Data.** (Recommended above.) Storing notes in the Tauri App Data Directory fights your backup, portability, and sync goals. Keep the vault a user-chosen folder; use App Data for app config + a registry of vaults. This is the Obsidian model and it's the right one here.

2. **Generate TS types from Rust (`specta`/`tauri-specta`).** Your strict boundary is only as safe as its contract. Auto-generating TypeScript types from the Rust command signatures means the frontend can't drift from the core, and refactors surface as compile errors instead of runtime bugs. High payoff for low cost — set it up in Phase 0.

3. **"CRDT-ready" beats "CRDT-now" given the JSON decision.** Persisting a raw Yjs update-log isn't "JSON files," so full CRDT-on-disk conflicts with your storage choice. Storing JSON snapshots with stable block IDs (and a block tree that maps to Yjs) keeps files clean *and* makes Phase 4 a wrapping step. Just never let a block lose its ID.

4. **Pick the graph library by scale.** `react-force-graph` is quick to wire up but struggles past a few thousand nodes. `sigma.js` + `graphology` renders with WebGL and holds up on large vaults. Since the graph is a headline feature and a perf-critical surface, lean `sigma`.

5. **Zustand for UI state, nothing more.** A lean signal-of-truth for view state (open note, panes, selection). Resist the temptation to cache note *content* in the frontend store — that reintroduces the "data logic in React" problem. The store holds UI state; the core holds data.

6. **Debounced, atomic autosave from day one.** The vault is the user's life's work. Write to a temp file and rename (atomic), debounce editor saves, and never hold the only copy in memory. Pair with the backup feature early rather than treating it as polish.

7. **Define an error strategy in Phase 0.** One Rust error enum (`thiserror`) mapped to typed IPC errors the service layer can branch on. Decide now what a "vault locked / file missing / schema too new" looks like end-to-end, so the UI degrades gracefully instead of throwing raw strings.

8. **Budget for WebKitGTK.** On Linux, Tauri uses WebKitGTK, which is where editor/graph rendering quirks tend to appear. Test there regularly rather than discovering it at release.

9. **Twemoji is community-maintained now.** Twitter/X archived the original repo; use a currently-maintained Twemoji fork for the icon set so you're not depending on abandoned assets.

10. **Version the schema from the first commit.** `schemaVersion` is already in the note JSON above — write the migration path (even a no-op) in Phase 0 so future format changes never require touching users' files by hand.

---

## 9. Open decisions to lock

- **Vault location:** user-chosen folder (recommended) vs. App Data Directory (as originally written).
- **Folders on disk vs. logical:** real directories (recommended, portable) vs. `parentId` in JSON.
- **Graph library:** `sigma`/`graphology` (scale) vs. `react-force-graph` (simplicity).
- **Spellcheck engine:** `zspell` pure-Rust (recommended) vs. `hunspell-rs` C binding.
- **Phase 5 LLM host:** Ollama (external local runtime) vs. `candle` (in-process Rust).
