use super::*;

/// Copy `src_path` (chosen via the native file dialog in `services`) into
/// `attachments/icons/`, returning its vault-relative path for `Icon::Custom`.
#[tauri::command]
#[specta::specta]
pub fn import_icon(state: State<AppState>, src_path: String) -> Result<String, CoreError> {
    current(&state)?.import_icon(std::path::Path::new(&src_path))
}

/// Copy `src_path` (chosen via the native file dialog in `services`) into the
/// vault's `attachments/images/` library for use as a note banner, returning its
/// vault-relative path for `Banner::Image`.
#[tauri::command]
#[specta::specta]
pub fn import_banner(state: State<AppState>, src_path: String) -> Result<String, CoreError> {
    current(&state)?.import_banner(std::path::Path::new(&src_path))
}

/// Import an attachment by content (Phase 2 step 1): the frontend reads a
/// browser `File`'s bytes and forwards them here; the core hashes them (blake3),
/// stores them content-addressed under `attachments/<kind>/`, and returns the
/// vault-relative path the editor stores in the embedding block. No attachment
/// bytes are ever written from the frontend.
#[tauri::command]
#[specta::specta]
pub fn import_attachment(
    state: State<AppState>,
    kind: AttachmentKind,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, CoreError> {
    current(&state)?.import_attachment(kind, &file_name, &bytes)
}
