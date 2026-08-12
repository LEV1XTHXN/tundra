//! Deleting a whole vault from disk.
//!
//! A free function rather than a method on `Vault`: the vault being deleted is
//! usually NOT the open one, so there is no `Vault` handle to hang this off —
//! only a path from the known-vaults registry.
//!
//! This is the single most destructive operation in the app, so it is the one
//! place that deliberately does not erase anything: the whole root goes to the
//! OS trash, where the user can get it back.

use super::*;

/// Move the entire vault directory at `path` to the OS trash — notes,
/// attachments, templates, `.vault/` and anything else the user kept in that
/// folder (the vault root is user-chosen, so "the vault" is the folder).
///
/// Returns `Ok(())` when the path is already gone, so a vault the user deleted
/// outside the app can still be cleared from the known-vaults registry instead
/// of being stuck there behind an error.
///
/// The guards below are the last line of defence before a recursive delete of a
/// user-chosen absolute path — same reasoning as `paths::validate_rel`, applied
/// at the one chokepoint every caller goes through. Callers that know more
/// (the Tauri layer knows the registry and the user's home/Documents paths) add
/// their own checks on top; these are the ones that hold everywhere.
pub fn trash_vault_dir(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    if !path.is_dir() {
        return Err(CoreError::Vault(format!(
            "{} is not a directory",
            path.display()
        )));
    }
    // Refuse anything that isn't recognisably a vault. `Vault::open` always
    // creates `.vault/` (see `DIRS`), so its absence means this path is not a
    // vault we made — a stale registry entry, or a folder that was replaced
    // since. Deleting it would destroy data the app never owned.
    if !path.join(".vault").is_dir() {
        return Err(CoreError::Vault(format!(
            "{} is not a Tundra vault (no .vault folder) — refusing to delete it",
            path.display()
        )));
    }
    // A path with no parent is a filesystem root.
    if path.parent().is_none() {
        return Err(CoreError::Vault(format!(
            "refusing to delete the filesystem root {}",
            path.display()
        )));
    }

    // Deliberately no `remove_dir_all` fallback: the promise made in the
    // confirmation dialog is that the folder is recoverable from the trash. If
    // the platform can't trash it, the honest outcome is an error the user can
    // act on — not a silent permanent erase of their whole vault.
    trash::delete(path).map_err(|e| {
        CoreError::Io(format!(
            "could not move {} to the trash: {e}",
            path.display()
        ))
    })
}
