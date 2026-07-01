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

## Repointing / fixing the vault (no in-app switch yet)

The Phase 0 skeleton always reopens `lastVault` and has **no UI to switch or move a
vault**. To repoint manually:

1. Quit the app.
2. Edit `state.json` to the desired absolute path, **or** delete it to force the
   onboarding screen on next launch.
3. Relaunch (`npm run tauri dev`).

The vault folder itself is portable — you can `mv` it anywhere on disk, then update
`lastVault` to the new path.

**Planned:** a "Switch/Add vault" action in the `settings` module (Phase 1 grows,
Phase 3 polish) removes the need for any of this manual editing.
