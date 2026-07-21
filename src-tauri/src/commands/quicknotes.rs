use super::*;

/// Read the single quick-note scratchpad (Phase 2 step 5), or a fresh empty one
/// if nothing's been captured yet. It's not one of the vault's notes — it lives
/// in its own file and never appears in the tree/search/graph.
#[tauri::command]
#[specta::specta]
pub fn read_quick_note(state: State<AppState>) -> Result<Note, CoreError> {
    current(&state)?.read_quick_note()
}

/// Persist the quick-note scratchpad. Deliberately does NOT touch the search or
/// link indexes — the quick note is outside the notes tree.
#[tauri::command]
#[specta::specta]
pub fn save_quick_note(state: State<AppState>, note: Note) -> Result<(), CoreError> {
    current(&state)?.save_quick_note(note)
}
