use super::*;

#[tauri::command]
#[specta::specta]
pub fn list_notes(state: State<AppState>) -> Result<Vec<NoteSummary>, CoreError> {
    current(&state)?.list_notes()
}

#[tauri::command]
#[specta::specta]
pub fn create_note(state: State<AppState>, title: String) -> Result<Note, CoreError> {
    let vault = current(&state)?;
    let note = vault.create_note(&title)?;
    reindex_after_write(&vault, current_search(&state)?.as_ref(), &note);
    let _ = current_links(&state)?.index_note(&note);
    Ok(note)
}

#[tauri::command]
#[specta::specta]
pub fn read_note(state: State<AppState>, id: String) -> Result<Note, CoreError> {
    current(&state)?.read_note(&id)
}

#[tauri::command]
#[specta::specta]
pub fn save_note(state: State<AppState>, note: Note) -> Result<(), CoreError> {
    let vault = current(&state)?;
    vault.save_note(note.clone())?;
    reindex_after_write(&vault, current_search(&state)?.as_ref(), &note);
    let _ = current_links(&state)?.index_note(&note);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn delete_note(state: State<AppState>, id: String) -> Result<(), CoreError> {
    current(&state)?.delete_note(&id)?;
    let _ = current_search(&state)?.remove_note(&id);
    let _ = current_links(&state)?.remove_note(&id);
    Ok(())
}

/// Vault cleanup (settings): delete every note whose body is empty, regardless of
/// title (see `Note::is_empty`). Mirrors `delete_note`'s index upkeep for each
/// removed note and returns the ids that were deleted (the frontend shows the
/// count and refreshes the tree). Notes carrying an image/table/other embed are
/// kept.
#[tauri::command]
#[specta::specta]
pub fn cleanup_empty_notes(state: State<AppState>) -> Result<Vec<String>, CoreError> {
    let vault = current(&state)?;
    let ids = vault.empty_note_ids()?;
    let search = current_search(&state)?;
    let links = current_links(&state)?;
    for id in &ids {
        vault.delete_note(id)?;
        let _ = search.remove_note(id);
        let _ = links.remove_note(id);
    }
    Ok(ids)
}

#[tauri::command]
#[specta::specta]
pub fn move_note(state: State<AppState>, id: String, new_folder: String) -> Result<(), CoreError> {
    current(&state)?.move_note(&id, &new_folder)
}

/// Create a note directly inside `folder` (relative to the notes root, `""`
/// for the root) — the "new note in the selected folder" nav action.
#[tauri::command]
#[specta::specta]
pub fn create_note_in(
    state: State<AppState>,
    title: String,
    folder: String,
) -> Result<Note, CoreError> {
    let vault = current(&state)?;
    let note = vault.create_note_in(&title, &folder)?;
    reindex_after_write(&vault, current_search(&state)?.as_ref(), &note);
    let _ = current_links(&state)?.index_note(&note);
    Ok(note)
}

// --- note properties (folder table view) --------------------------------

/// Set (or clear, with a `null` value) one user-defined property value on a
/// note. `value` is a raw JSON string (the serialized property value), or `null`
/// to clear the key — the same raw-JSON-string boundary as the config
/// passthrough, since specta can't pass an opaque `serde_json::Value` as a
/// command arg. The folder table view owns the property-type system; the core
/// just stores + mirrors the value for rendering/sorting.
#[tauri::command]
#[specta::specta]
pub fn set_note_property(
    state: State<AppState>,
    id: String,
    key: String,
    value: Option<String>,
) -> Result<(), CoreError> {
    let parsed = match value {
        Some(json) => Some(serde_json::from_str(&json)?),
        None => None,
    };
    current(&state)?.set_note_property(&id, &key, parsed)
}
