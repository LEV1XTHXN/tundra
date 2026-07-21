use super::*;

use tundra_core::import;

/// List every file under an arbitrary source folder (e.g. an Obsidian vault
/// the user picked via the native folder dialog) — pure FS read, no vault
/// involved. The frontend adapter classifies each entry into note/attachment/
/// skip; this command only ever enumerates.
#[tauri::command]
#[specta::specta]
pub fn import_scan_folder(path: String) -> Result<Vec<tundra_core::SourceFile>, CoreError> {
    import::scan_folder(std::path::Path::new(&path))
}

/// Read one source file's raw text (a note's Markdown, before any conversion)
/// by absolute path. Never parses Markdown — that's BlockNote's job on the
/// frontend (CLAUDE.md's locked rule).
#[tauri::command]
#[specta::specta]
pub fn import_read_text_file(path: String) -> Result<String, CoreError> {
    import::read_text_file(std::path::Path::new(&path))
}

/// Copy one attachment from the import source into the currently open vault
/// (the import pipeline's destination — always a fresh vault opened via the
/// existing multi-vault flow before import runs), returning its new
/// vault-relative path for the note block that will embed it.
#[tauri::command]
#[specta::specta]
pub fn import_copy_attachment(
    state: State<AppState>,
    kind: AttachmentKind,
    src_path: String,
) -> Result<String, CoreError> {
    current(&state)?.import_attachment_from_path(kind, std::path::Path::new(&src_path))
}
