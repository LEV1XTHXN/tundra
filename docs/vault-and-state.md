# Vault & app state (`vault`)

## Two separate storage locations

1. **The vault** — a user-chosen folder holding all notes + attachments. Portable,
   browsable, backup-able (CLAUDE.md §5.1). Created/opened by `Vault::open()` in
   `crates/tundra-core/src/vault.rs`, which lays down this structure *inside the
   chosen folder*:

   ```
   .vault/        notes/        attachments/{images,videos,files,icons}
   ```

   > Because those dirs are created directly inside whatever folder you pick,
   > **onboard onto an empty/new folder** — pointing at an existing folder (e.g.
   > `Documents/BlackmagicDesign`) scatters vault dirs into it.

2. **App state** — app-level config only (which vault was last open, etc.), stored
   in the OS app-config dir, **not** in the vault. Written by `open_vault` in
   `src-tauri/src/commands.rs` as `state.json`:

   ```json
   { "lastVault": "/absolute/path/to/vault" }
   ```

   Per-OS location (Tauri `app_config_dir()` + identifier `com.tundra.app`):

   | OS | Path |
   |----|------|
   | Linux | `~/.config/com.tundra.app/state.json` |
   | Windows | `%APPDATA%\com.tundra.app\state.json` (Roaming) |
   | macOS | `~/Library/Application Support/com.tundra.app/state.json` |

   This dir is per-machine, so each developer's "last vault" is independent — it is
   never in the repo.

## Note identity

A note's canonical identity is the **UUID inside the file**, not its path. The
filename is a slug of the title (convenience only), so notes can move/rename without
breaking links later. Lookups by id currently scan `notes/` (fine at Phase 0 scale;
the `links` module builds a real id→path map in Phase 2).

## Opening an already-open vault is a no-op

`open_vault` returns early when the requested path resolves (canonicalized) to the
vault already in `AppState` — `is_same_vault` in `commands/vault.rs`. This is not an
optimization: the process holds a live Tantivy `IndexWriter` for the open vault, which
owns the exclusive lock on `.vault/cache/search/`. Building a second one for the same
directory fails with `LockBusy`, and since the old writer is only dropped at the state
swap at the end of `open_vault`, it then fails on *every* retry — the vault becomes
unopenable (even from the onboarding folder picker) until the app restarts.

That is exactly what a **webview reload** used to trigger: the frontend reboots but the
Rust process does not, so the boot effect calls `open_vault(lastVault)` against handles
that were never released. Two independent guards now exist — the reload path itself is
gone (the native context menu, and with it its Reload item, is suppressed — see
`src/app/contextMenuSuppressor.ts`; in dev, Shift+right-click still opens it), and the
command is idempotent, so any future duplicate open just returns the open vault's info.

Corollary for anything that later reaches into `AppState` on startup: **a reload does
not reset Rust state.** Watcher, indexes and stores all survive it.

## Vault cleanup (delete empty notes)

Settings → **Maintenance** → "Clean up vault" deletes every note whose **body is
empty**, regardless of title, to clear out notes started but never written in.

- **Emptiness is a body-only check** (`Note::is_empty`, `document.rs`): a note is
  empty only when every block is a plain-text block (`TEXT_BLOCK_TYPES`) with no
  non-whitespace text. Any non-text block (image/video/file/table/code, or any
  unrecognized/custom type) counts as content, so a note holding an embed is
  **kept** even with no words. The title is deliberately ignored — a
  titled-but-bodyless note is still deleted (product decision).
- **Flow:** `Vault::empty_note_ids` reads each note body (summaries don't carry
  blocks) and returns the empties; the `cleanup_empty_notes` command deletes each
  via the same path as `delete_note` (file + `.bak` removed, dropped from the
  in-memory, search, and link indexes) and returns the deleted ids. The frontend
  (`notes.cleanupEmpty`) reports the count and, via `App.onVaultCleaned`, refreshes
  the tree and closes the open note if it was deleted.
- The settings button reveals an inline **confirm** before running (destructive,
  irreversible). Reading every body on demand is acceptable for a rare, explicit
  action.

## Deleting a vault

The trash icon on each row of the sidebar's vault switcher **deletes the vault**:
`delete_vault` (`src-tauri/src/commands/vault.rs`) moves the *entire vault root
folder* to the OS trash and drops the entry from the known-vaults registry. The
root is a user-chosen folder, so "the vault" means the whole folder — notes,
attachments, templates, `.vault/`, and anything else kept alongside them.

**Trash, never erase.** `tundra_core::trash_vault_dir` uses the `trash` crate and
deliberately has **no `remove_dir_all` fallback**: the confirmation dialog promises
the folder is recoverable, so a platform that can't trash it must produce an error,
not a silent permanent delete.

Four guards stand between the command and the filesystem:

| Guard | Where | Rejects |
|---|---|---|
| Path is in the known-vaults registry | `ensure_deletable` (commands) | Any directory the app didn't register — the command can't be used as "trash any path" |
| Not the home or Documents folder | `ensure_deletable` (commands) | The user who once picked `~` as a vault root; those hold a real `.vault/`, so the core guard would say yes |
| Contains a `.vault/` directory | `trash_vault_dir` (core) | Stale registry entries and folders replaced since they were registered |
| Not a file, not the filesystem root | `trash_vault_dir` (core) | The obvious catastrophes |

A path that no longer exists is **not** an error — it returns `Ok(())` so a vault
the user deleted outside the app can still be cleared from the registry.

### Deleting the vault that's open

Allowed, and it's the case with a teardown order that matters. Before touching the
filesystem, `delete_vault` clears the `AppState` handles **watcher first**, then
search/links/calendar/kanban/spellcheck, then the vault. The watcher's callback owns
clones of the search and link `Arc`s, so dropping it first is what actually lets the
`SearchIndex` drop — and with it Tantivy's exclusive lock on `.vault/cache/search/`,
which Windows will not let you move a directory out from under.

The command returns `true` in that case; `useVaultSession.deleteVault` reacts by
clearing `vaultInfo`, which drops the app back to the onboarding screen. `apply_forget`
also clears `lastVault`, so the next launch onboards instead of reopening a trashed path.

Because the teardown happens *before* the folder moves, a failure at the trash step
would leave the core holding no vault while the UI still shows one — every later
command would fail with "no vault is open". `useVaultSession.deleteVault` therefore
re-opens the vault on error before surfacing it. The registry entry is only dropped
*after* a successful trash, for the same reason: a vault that's still on disk stays
in the list.

## Repointing / moving a vault

Switching vaults is in-app (the sidebar switcher — "Open vault…" / "Create new vault"),
and there is no "remove from the list but keep the files" action: the only removal is
the delete above. The vault folder is portable, so to move one, `mv` it and then open
it from its new location; the old entry can be deleted afterwards (a missing path is
handled, see above). Deleting `state.json` still forces the onboarding screen on the
next launch.
