use super::*;

/// Read a vault-scoped config file under `.vault/config/<name>` (Phase 2 step 4:
/// graph view settings; step 6: home dashboard layout). Returns the raw JSON
/// string, or `None` if it hasn't been written yet — the caller parses it. This
/// keeps vault UI state out of `localStorage` and in the vault where it can sync
/// (CLAUDE.md §4/§5.2).
#[tauri::command]
#[specta::specta]
pub fn read_vault_config(state: State<AppState>, name: String) -> Result<Option<String>, CoreError> {
    current(&state)?.read_config(&name)
}

/// Write a vault-scoped config file under `.vault/config/<name>` atomically —
/// the FS counterpart of `read_vault_config`.
#[tauri::command]
#[specta::specta]
pub fn write_vault_config(
    state: State<AppState>,
    name: String,
    contents: String,
) -> Result<(), CoreError> {
    current(&state)?.write_config(&name, &contents)
}

/// Path to an app-scoped settings blob at `{app_config_dir}/settings/<name>.json`.
/// App settings are *global* preferences (keybindings, and later appearance/etc.)
/// that persist across vaults — NOT vault content (CLAUDE.md §5.1). `name` is
/// restricted to a bare identifier so a caller can never traverse out of the
/// settings dir.
pub(super) fn app_settings_path(app: &AppHandle, name: &str) -> Result<std::path::PathBuf, CoreError> {
    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(CoreError::Vault(format!("invalid settings name: {name:?}")));
    }
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| CoreError::Io(e.to_string()))?
        .join("settings");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join(format!("{name}.json")))
}

/// Read an app-scoped settings blob (a global preference that persists across
/// vaults), or `None` if it hasn't been written yet. Returns the raw JSON string;
/// the caller parses it (mirrors `read_vault_config`, but app- not vault-scoped).
#[tauri::command]
#[specta::specta]
pub fn read_app_settings(app: AppHandle, name: String) -> Result<Option<String>, CoreError> {
    let path = app_settings_path(&app, &name)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Write an app-scoped settings blob atomically (temp file + rename, so a crash
/// mid-write never truncates an existing file) — the FS counterpart of
/// `read_app_settings`.
#[tauri::command]
#[specta::specta]
pub fn write_app_settings(app: AppHandle, name: String, contents: String) -> Result<(), CoreError> {
    let path = app_settings_path(&app, &name)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, contents.as_bytes())?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}
