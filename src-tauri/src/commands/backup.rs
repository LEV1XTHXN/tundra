use super::*;

// --- backup (Phase 3 step 3) --------------------------------------------

/// One-click backup: zip the whole vault (excluding the rebuildable
/// `.vault/cache/`) into `dest_dir` — which must be OUTSIDE the vault — verify
/// the archive is readable, and return its path. The frontend remembers
/// `dest_dir` in app-settings (global, cross-vault).
#[tauri::command]
#[specta::specta]
pub fn backup_vault(state: State<AppState>, dest_dir: String) -> Result<String, CoreError> {
    let path = tundra_core::backup::backup_vault(&current(&state)?, std::path::Path::new(&dest_dir))?;
    Ok(path.to_string_lossy().into_owned())
}
