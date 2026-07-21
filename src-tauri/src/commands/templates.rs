use super::*;

// --- templates ----------------------------------------------------------
//
// Templates are reusable, `Note`-shaped documents stored under the vault's
// `templates/` directory — OUTSIDE `notes/` — so, like the quick note, they
// never touch the search or link indexes and never appear in the tree. The
// commands are thin passthroughs to the core, matching the note CRUD shape.

/// Every template's shallow summary (id/title/icon), title-sorted.
#[tauri::command]
#[specta::specta]
pub fn list_templates(state: State<AppState>) -> Result<Vec<tundra_core::TemplateSummary>, CoreError> {
    current(&state)?.list_templates()
}

/// Create a new, empty template and return it.
#[tauri::command]
#[specta::specta]
pub fn create_template(state: State<AppState>, title: String) -> Result<Note, CoreError> {
    current(&state)?.create_template(&title)
}

/// Read a template's full document by id.
#[tauri::command]
#[specta::specta]
pub fn read_template(state: State<AppState>, id: String) -> Result<Note, CoreError> {
    current(&state)?.read_template(&id)
}

/// Persist an edited template (validated + atomic, like a note). Deliberately
/// does NOT touch the search or link indexes — templates are outside the notes tree.
#[tauri::command]
#[specta::specta]
pub fn save_template(state: State<AppState>, note: Note) -> Result<(), CoreError> {
    current(&state)?.save_template(note)
}

/// Delete a template by id.
#[tauri::command]
#[specta::specta]
pub fn delete_template(state: State<AppState>, id: String) -> Result<(), CoreError> {
    current(&state)?.delete_template(&id)
}
