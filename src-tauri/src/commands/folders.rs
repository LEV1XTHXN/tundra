use super::*;

/// The folder/note tree for the open vault.
#[tauri::command]
#[specta::specta]
pub fn list_tree(state: State<AppState>) -> Result<Vec<TreeNode>, CoreError> {
    Ok(current(&state)?.list_tree())
}

#[tauri::command]
#[specta::specta]
pub fn create_folder(state: State<AppState>, path: String) -> Result<(), CoreError> {
    current(&state)?.create_folder(&path)
}

#[tauri::command]
#[specta::specta]
pub fn rename_folder(
    state: State<AppState>,
    path: String,
    new_name: String,
) -> Result<(), CoreError> {
    current(&state)?.rename_folder(&path, &new_name)
}

#[tauri::command]
#[specta::specta]
pub fn move_folder(
    state: State<AppState>,
    path: String,
    new_parent: String,
) -> Result<(), CoreError> {
    current(&state)?.move_folder(&path, &new_parent)
}

#[tauri::command]
#[specta::specta]
pub fn delete_folder(state: State<AppState>, path: String) -> Result<(), CoreError> {
    current(&state)?.delete_folder(&path)
}
