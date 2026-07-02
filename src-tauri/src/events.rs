//! Typed frontend events (Phase 1 step 8) — emitted when the file watcher
//! (`tundra_core::watcher`) detects a genuine external change. Registered via
//! `collect_events!` alongside `collect_commands!` so the shapes land in
//! `bindings.ts` too.

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri_specta::Event;

/// The folder/note tree changed shape, or a note's title/icon changed on
/// disk — the frontend should refresh the nav tree.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct TreeChanged;

/// A specific note's content changed on disk, not caused by this app's own
/// write. The frontend applies the clean/dirty/deleted reconciliation policy
/// if it's the currently open note.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct NoteChangedExternally {
    pub id: String,
}
