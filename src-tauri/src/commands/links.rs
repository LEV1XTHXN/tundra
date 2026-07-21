use super::*;

/// Notes that link *to* `id` (incoming links), as current summaries — the
/// editor's backlinks panel (Phase 2 step 2).
#[tauri::command]
#[specta::specta]
pub fn backlinks(state: State<AppState>, id: String) -> Result<Vec<NoteSummary>, CoreError> {
    Ok(current_links(&state)?.backlinks(&current(&state)?, &id))
}

/// The whole directed link graph (nodes = notes, edges = resolved links) for
/// the graph view (Phase 2 step 2/4). Broken links are excluded.
#[tauri::command]
#[specta::specta]
pub fn graph_data(state: State<AppState>) -> Result<GraphData, CoreError> {
    current_links(&state)?.graph_data(&current(&state)?)
}

/// Resolve note ids to their CURRENT summaries (title/icon) — for live link
/// labels; ids that no longer resolve are omitted (the caller uses the stored
/// label for those).
#[tauri::command]
#[specta::specta]
pub fn resolve_titles(state: State<AppState>, ids: Vec<String>) -> Result<Vec<NoteSummary>, CoreError> {
    Ok(current_links(&state)?.resolve_titles(&current(&state)?, &ids))
}

/// Rebuild the link graph from the notes on disk (recovery action — the graph
/// cache is derived/rebuildable).
#[tauri::command]
#[specta::specta]
pub fn rebuild_graph(state: State<AppState>) -> Result<(), CoreError> {
    current_links(&state)?.rebuild(&current(&state)?)
}
