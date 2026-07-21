use super::*;

use super::tags::reindex_tags;

// --- kanban (Phase 3+) --------------------------------------------------
//
// Every mutation returns the full, freshly-persisted board list so the frontend
// replaces its state in one round trip (boards are small; this avoids client-side
// reconciliation bugs). Card moves also mutate note tags in the core, so a fresh
// `list_notes`/inspector read reflects the tag change immediately.

/// All Kanban boards (tab order).
#[tauri::command]
#[specta::specta]
pub fn kanban_boards(state: State<AppState>) -> Result<Vec<KanbanBoard>, CoreError> {
    Ok(current_kanban(&state)?.list())
}

/// Create a board (seeded with To do / Doing / Done columns); returns all boards.
#[tauri::command]
#[specta::specta]
pub fn kanban_create_board(state: State<AppState>, name: String) -> Result<Vec<KanbanBoard>, CoreError> {
    current_kanban(&state)?.create_board(&current(&state)?, &name)
}

/// Rename a board.
#[tauri::command]
#[specta::specta]
pub fn kanban_rename_board(
    state: State<AppState>,
    board_id: String,
    name: String,
) -> Result<Vec<KanbanBoard>, CoreError> {
    current_kanban(&state)?.rename_board(&current(&state)?, &board_id, &name)
}

/// Delete a board (note tags are left as-is).
#[tauri::command]
#[specta::specta]
pub fn kanban_delete_board(state: State<AppState>, board_id: String) -> Result<Vec<KanbanBoard>, CoreError> {
    current_kanban(&state)?.delete_board(&current(&state)?, &board_id)
}

/// Append a column to a board, optionally with an auto-assign tag.
#[tauri::command]
#[specta::specta]
pub fn kanban_add_column(
    state: State<AppState>,
    board_id: String,
    name: String,
    tag: Option<String>,
) -> Result<Vec<KanbanBoard>, CoreError> {
    current_kanban(&state)?.add_column(&current(&state)?, &board_id, &name, tag)
}

/// Rename a column and/or change its auto-assign tag.
#[tauri::command]
#[specta::specta]
pub fn kanban_update_column(
    state: State<AppState>,
    board_id: String,
    column_id: String,
    name: String,
    tag: Option<String>,
) -> Result<Vec<KanbanBoard>, CoreError> {
    current_kanban(&state)?.update_column(&current(&state)?, &board_id, &column_id, &name, tag)
}

/// Delete a column (its cards drop off the board; note tags left as-is).
#[tauri::command]
#[specta::specta]
pub fn kanban_delete_column(
    state: State<AppState>,
    board_id: String,
    column_id: String,
) -> Result<Vec<KanbanBoard>, CoreError> {
    current_kanban(&state)?.delete_column(&current(&state)?, &board_id, &column_id)
}

/// Reorder a board's columns (move `column_id` to `to_index`).
#[tauri::command]
#[specta::specta]
pub fn kanban_move_column(
    state: State<AppState>,
    board_id: String,
    column_id: String,
    to_index: u32,
) -> Result<Vec<KanbanBoard>, CoreError> {
    current_kanban(&state)?.move_column(&current(&state)?, &board_id, &column_id, to_index as usize)
}

/// Add a note to a column (applies the column's tag). Moves it if already on the board.
#[tauri::command]
#[specta::specta]
pub fn kanban_add_card(
    state: State<AppState>,
    board_id: String,
    column_id: String,
    note_id: String,
) -> Result<Vec<KanbanBoard>, CoreError> {
    let boards = current_kanban(&state)?.add_card(&current(&state)?, &board_id, &column_id, &note_id)?;
    // The card's note may have gained the column's tag — refresh the search
    // index so `#tag` sees it. Best-effort: a dangling note id shouldn't fail
    // the board mutation the user asked for.
    let _ = reindex_tags(&state, &note_id);
    Ok(boards)
}

/// Move a note to `to_column_id` at `to_index` (swaps the source/destination tags).
#[tauri::command]
#[specta::specta]
pub fn kanban_move_card(
    state: State<AppState>,
    board_id: String,
    note_id: String,
    to_column_id: String,
    to_index: u32,
) -> Result<Vec<KanbanBoard>, CoreError> {
    let boards = current_kanban(&state)?.move_card(&current(&state)?, &board_id, &note_id, &to_column_id, to_index as usize)?;
    // The move swapped the source/destination column tags on the note.
    let _ = reindex_tags(&state, &note_id);
    Ok(boards)
}

/// Remove a note from a board (strips the tag of the column it was in).
#[tauri::command]
#[specta::specta]
pub fn kanban_remove_card(
    state: State<AppState>,
    board_id: String,
    note_id: String,
) -> Result<Vec<KanbanBoard>, CoreError> {
    let boards = current_kanban(&state)?.remove_card(&current(&state)?, &board_id, &note_id)?;
    // The note lost the column's tag (if any).
    let _ = reindex_tags(&state, &note_id);
    Ok(boards)
}
