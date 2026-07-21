use super::*;

// --- calendar (Phase 3 step 1) ------------------------------------------

/// All calendar events in the open vault.
#[tauri::command]
#[specta::specta]
pub fn list_events(state: State<AppState>) -> Result<Vec<CalendarEvent>, CoreError> {
    Ok(current_calendar(&state)?.list())
}

/// Create an event (a fresh UUID is assigned if `event.id` is empty) and return
/// the stored form.
#[tauri::command]
#[specta::specta]
pub fn create_event(state: State<AppState>, event: CalendarEvent) -> Result<CalendarEvent, CoreError> {
    current_calendar(&state)?.add(&current(&state)?, event)
}

/// Update an existing event (matched by id).
#[tauri::command]
#[specta::specta]
pub fn update_event(state: State<AppState>, event: CalendarEvent) -> Result<(), CoreError> {
    current_calendar(&state)?.update(&current(&state)?, event)
}

/// Delete an event by id.
#[tauri::command]
#[specta::specta]
pub fn delete_event(state: State<AppState>, id: String) -> Result<(), CoreError> {
    current_calendar(&state)?.delete(&current(&state)?, &id)
}

/// Everything on the calendar in the inclusive `[start, end]` day range: both
/// standalone events and note→date links (served from the in-memory index).
#[tauri::command]
#[specta::specta]
pub fn calendar_range(
    state: State<AppState>,
    start: NaiveDate,
    end: NaiveDate,
) -> Result<CalendarRange, CoreError> {
    let vault = current(&state)?;
    let calendar = current_calendar(&state)?;
    Ok(tundra_core::range_query(&vault, &calendar, start, end))
}

/// Link a note to a date (optionally a specific event), stored on the note's meta
/// and mirrored into the index.
#[tauri::command]
#[specta::specta]
pub fn add_note_date(state: State<AppState>, id: String, date: NoteDate) -> Result<(), CoreError> {
    current(&state)?.add_note_date(&id, date)
}

/// Remove a note→date link (matched exactly).
#[tauri::command]
#[specta::specta]
pub fn remove_note_date(
    state: State<AppState>,
    id: String,
    date: NoteDate,
) -> Result<(), CoreError> {
    current(&state)?.remove_note_date(&id, &date)
}
