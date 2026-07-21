use super::*;

/// Ranked full-text search hits (id, title, snippet) for `query`.
#[tauri::command]
#[specta::specta]
pub fn search_query(state: State<AppState>, query: String, limit: u32) -> Result<Vec<SearchHit>, CoreError> {
    current_search(&state)?.search(&query, limit as usize)
}

/// Tag-filtered search hits (id, title, and the note's tag set as snippet) for
/// `tag_query` — the global search's `#tag` mode. Matches only the `tags` field.
#[tauri::command]
#[specta::specta]
pub fn search_by_tag(state: State<AppState>, tag_query: String, limit: u32) -> Result<Vec<SearchHit>, CoreError> {
    current_search(&state)?.search_by_tag(&tag_query, limit as usize)
}

/// Rebuild the search index from scratch (a user-triggered recovery action —
/// the index is derived/rebuildable, never a source of truth).
#[tauri::command]
#[specta::specta]
pub fn rebuild_index(state: State<AppState>) -> Result<(), CoreError> {
    current_search(&state)?.rebuild(&current(&state)?)
}
