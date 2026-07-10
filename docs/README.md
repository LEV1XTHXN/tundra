# Developer notes

Shared, version-controlled notes for whoever works on Tundra. Unlike `CLAUDE.md`
(the product spec and locked architecture), this folder is for the **practical,
hard-won stuff discovered while implementing**: gotchas, why a non-obvious
decision was made, per-OS quirks, and "how do I regenerate X" answers.

If you spend more than a few minutes figuring something out that the next person
would also have to, drop a note here.

## Index

- [`dev-setup.md`](dev-setup.md) — toolchain + per-OS prerequisites (Linux / Windows / macOS) to build and run.
- [`ipc-and-bindings.md`](ipc-and-bindings.md) — the typed Rust↔TS boundary, specta version pinning, how/when to regenerate `bindings.ts`, and the `serde_json::Value` export gotcha.
- [`vault-and-state.md`](vault-and-state.md) — vault layout, where the "last vault" pointer lives per OS, and how to repoint it (there's no in-app vault switch yet).
- [`file-watcher.md`](file-watcher.md) — how external-change detection works, and the `notify` "reads look like changes" gotcha that caused an infinite reload loop (open a note → reloads every second).
- [`ui-fonts.md`](ui-fonts.md) — the UI font (Inter), why text looks thin on WebKitGTK/WKWebView, and the one-knob global weight nudge (`--ui-text-weight`).
- [`graph-and-views.md`](graph-and-views.md) — the shell view switcher, the sigma/graphology graph view (imperative + FA2 worker), and the vault-scoped `.vault/config/*.json` store (Phase 2 step 4).
- [`keybindings.md`](keybindings.md) — the rebindable keybinding system (registry + matcher + app-scoped persistence), the Settings dialog, and the ProseMirror-based find-in-note.
- [`kanban-and-tags.md`](kanban-and-tags.md) — the Kanban board view, the note tag system, the column↔tag drag automation, and `#tag` search in the global palette.
- [`note-sorting-and-folder-tables.md`](note-sorting-and-folder-tables.md) — per-folder sidebar sorting (field / manual drag / pin) and the folder "database" table view with user-defined columns.

## Conventions

- One topic per file, kebab-case filename.
- Link to real code paths and commands, not vague descriptions.
- When something documented here changes in the code, update the note in the same commit.
