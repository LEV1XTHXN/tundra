use super::*;

// --- note tags (Phase 3+ / Kanban) --------------------------------------

/// Reindex a note into the search index after a tag change, so the `#tag`
/// search mode sees new/removed tags immediately instead of waiting for the
/// next vault-open catch-up. `save_note` only refreshes the vault's in-memory
/// summary index — the Tantivy index is the command layer's job (as with every
/// other note-persisting command; see `reindex_after_write`).
pub(super) fn reindex_tags(state: &State<AppState>, id: &str) -> Result<(), CoreError> {
    let vault = current(state)?;
    let note = vault.read_note(id)?;
    reindex_after_write(&vault, current_search(state)?.as_ref(), &note);
    Ok(())
}

/// Replace a note's tag set wholesale (trimmed + deduped by the core).
#[tauri::command]
#[specta::specta]
pub fn set_note_tags(state: State<AppState>, id: String, tags: Vec<String>) -> Result<(), CoreError> {
    current(&state)?.set_note_tags(&id, tags)?;
    reindex_tags(&state, &id)
}

/// Add one tag to a note (no-op if blank or already present).
#[tauri::command]
#[specta::specta]
pub fn add_note_tag(state: State<AppState>, id: String, tag: String) -> Result<(), CoreError> {
    current(&state)?.add_note_tag(&id, &tag)?;
    reindex_tags(&state, &id)
}

/// Remove one tag from a note (exact match).
#[tauri::command]
#[specta::specta]
pub fn remove_note_tag(state: State<AppState>, id: String, tag: String) -> Result<(), CoreError> {
    current(&state)?.remove_note_tag(&id, &tag)?;
    reindex_tags(&state, &id)
}

/// Rename a tag everywhere it appears in the vault (`from` → `to`). Every note
/// carrying the old tag is rewritten and reindexed so the `#tag` search + all
/// chips reflect the new name immediately. A no-op if `to` is blank or unchanged.
#[tauri::command]
#[specta::specta]
pub fn rename_tag(state: State<AppState>, from: String, to: String) -> Result<(), CoreError> {
    let vault = current(&state)?;
    let changed = vault.rename_tag(&from, &to)?;
    let search = current_search(&state)?;
    for id in changed {
        if let Ok(note) = vault.read_note(&id) {
            reindex_after_write(&vault, search.as_ref(), &note);
        }
    }
    Ok(())
}

/// Every distinct tag used in the vault, sorted — the pool for tag suggestions
/// and the settings tag manager.
#[tauri::command]
#[specta::specta]
pub fn list_tags(state: State<AppState>) -> Result<Vec<String>, CoreError> {
    Ok(current(&state)?.list_tags())
}

/// Delete a tag from the whole vault (permanent — removes it from every note that
/// carries it, unlike `remove_note_tag` which only touches one note). Every
/// affected note is reindexed so search + chips drop it immediately.
#[tauri::command]
#[specta::specta]
pub fn delete_tag(state: State<AppState>, tag: String) -> Result<(), CoreError> {
    let vault = current(&state)?;
    let changed = vault.delete_tag(&tag)?;
    let search = current_search(&state)?;
    for id in changed {
        if let Ok(note) = vault.read_note(&id) {
            reindex_after_write(&vault, search.as_ref(), &note);
        }
    }
    Ok(())
}
