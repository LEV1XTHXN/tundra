# Note-Taking App — Architecture, Modules & Roadmap

A local-first, Notion-style, Markdown-aware note app that scales to self-hosted sync across PC and phone, with a graph view, calendar, spellcheck, and a local AI agent.

---

## 1. Architectural spine

**One shared Rust core, many front doors.**

Build the logic once as a platform-agnostic Rust crate (`core`). It knows nothing about *how* it's invoked. Over the life of the project it gets called three ways:

| Consumer | How it uses the core | When |
| --- | --- | --- |
| Desktop app (Tauri shell) | In-process, via Tauri commands (IPC) | Now |
| Self-hosted sync server (Axum) | Same crate, wrapped in HTTP/WebSocket | Phase 4 |
| Mobile app (Tauri mobile) | Same crate via FFI | Phase 4 |

This is what makes "same vault on phone and PC later" a packaging change instead of a rewrite. Axum belongs to the sync server, not the local app.

### Recommended stack

- **Shell:** Tauri 2 (Rust core + system WebView). Tiny binaries, low memory, native Rust integration, and a real mobile path. *Fallback:* Electron + a Rust sidecar binary if Chromium-consistent rendering or the Node ecosystem is a hard requirement — keep the shared-core split either way.
- **Frontend:** React + TypeScript (+ Vite).
- **Editor:** BlockNote (block-based, Notion-style, built on TipTap/ProseMirror; Markdown import/export + input shortcuts). Drop to TipTap if you need more control.
- **CRDT:** `yrs` (Rust port of Yjs) to pair with BlockNote — *or* Loro / Automerge if you want a Rust-native model and will build the editor binding yourself.
- **Search:** Tantivy (Rust full-text search). Vector index added later for AI.
- **Server (later):** Axum, reusing `core`.

---

## 2. Decisions to lock before building

1. **Storage model:** block-tree-as-source-of-truth (recommended) with Markdown as import/export + shortcuts — *vs.* plain `.md` files (Obsidian-style). Most expensive thing to reverse.
2. **Editor + CRDT pairing:** choose them together (see stack table). BlockNote ⇒ Yjs/`yrs` is the low-friction default.
3. **CRDT now, sync later:** model documents as CRDT-backed from day one, ship local-only first.
4. **Vault on-disk format:** define the folder layout and note schema before writing features. Suggested layout below.

### Suggested vault layout
```
MyVault/
  .vault/                 # index, config, app metadata (not user content)
  notes/                  # note documents (block JSON or .md)
  attachments/
    images/               # all images across the vault
    videos/
    files/
  .dictionaries/          # custom spellcheck words
```

---

## 3. Module map

### Core (Rust crate)

| Module | Responsibility |
| --- | --- |
| `vault` | On-disk layout, folder tree, attachment libraries, file watching |
| `document` | Block/note model, metadata, per-note icon, CRDT-backed structure |
| `markdown` | Markdown ⇄ block-model import/export |
| `index` | Full-text search (Tantivy); later: vector index |
| `links` | Link resolution, backlinks, graph data for the graph view |
| `calendar` | Events, date ranges, date ⇄ note linking |
| `sync` | CRDT engine (local in early phases); transport to Axum later |
| `backup` | Vault → archive snapshot, written outside the vault |
| `spellcheck` | Hunspell dictionaries + personal word list |
| `agent` | RAG over the vault, tool-calling, embeddings, voice (last) |

### Frontend (React / TS)

| Module | Responsibility |
| --- | --- |
| `shell` | Layout, sidebar, panes, command palette |
| `editor` | BlockNote integration + custom blocks (tables, image/video embeds) |
| `nav` | Folder tree, nesting, drag-move, emoji/icon picker (Twemoji) |
| `graph` | Force-directed graph view (e.g. sigma.js / react-force-graph) |
| `quicknotes` | Dedicated quick-note panel |
| `calendar` | Calendar view, event editing, note links |
| `home` | Dashboard: pinned, recent, user-chosen widgets |
| `search` | Command palette + full-text (later semantic) results |
| `settings` | Backup button, dictionaries, sync config, appearance |
| `ai` | Chat-with-notes panel, voice input |

---

## 4. Phased roadmap

### Phase 0 — Foundations (spike)
- Lock the four decisions above.
- Monorepo: `core` crate + Tauri shell + React/TS frontend.
- Define vault format + note schema.
- **Walking skeleton:** create/open vault → create note → type → persist → reopen.

### Phase 1 — Core note-taking (MVP / daily driver)
- Block editor: headings, lists, formatting, Markdown shortcuts.
- Note tree: folders, nesting, create/rename/delete/move.
- Per-note emoji/icon (Twemoji).
- Local persistence + file watching.
- Full-text search (Tantivy).
- *CRDT model adopted internally, single-user.*

### Phase 2 — Rich content & structure
- Tables; image/video/attachment embeds stored in vault libraries.
- Links between notes (`[[wikilinks]]` / @-mentions) + backlinks panel.
- Graph view.
- Quick-notes section.
- Home/dashboard: recent, pinned, first widgets.

### Phase 3 — Productivity layer
- Calendar: events, time periods, note ⇄ date linking.
- Backup-to-archive feature (settings button → external snapshot).
- Multilingual spellcheck + custom dictionary (Hunspell).
- Settings polish.

### Phase 4 — Sync & mobile (local → self-hosted)
- Promote the CRDT model to real multi-device sync.
- Build the Axum sync server (reuses `core`).
- Mobile app via Tauri mobile (reuses `core` + most of the frontend).
- Conflict-free editing across PC + phone.

### Phase 5 — Local AI agent
- Embeddings + vector index over the vault (semantic search).
- RAG chat ("find biology info across my notes").
- Tool-calling actions (create note, create calendar event).
- Voice input (Whisper / whisper.cpp, local).

---

## 5. Cross-cutting concerns (thread through every phase)

- **Performance & robustness** (your top priority): keep heavy work in Rust off the UI thread; virtualize long note lists and the graph; treat the editor and graph as the two perf-critical WebView surfaces. Budget for Linux WebKitGTK testing if using Tauri.
- **Testing:** unit-test the `core` crate hard (it's reused by server + mobile); snapshot-test Markdown ⇄ block conversions; round-trip-test CRDT merges.
- **Data safety:** the vault is the user's life's work — autosave, atomic writes, and the backup feature are not optional polish.
- **Schema versioning:** version the note schema from Phase 0 so future migrations are clean.
