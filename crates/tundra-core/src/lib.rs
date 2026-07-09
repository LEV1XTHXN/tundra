//! `tundra-core` — all platform-agnostic data logic for the Tundra note app.
//!
//! This crate owns storage, the note/block model, and (later) indexing, links,
//! calendar, backup, and sync. The Tauri desktop shell, and any future sync
//! server or mobile app, are thin front doors over this same crate
//! (CLAUDE.md §2, "One Rust core, thin front doors").

pub mod calendar;
pub mod document;
pub mod error;
pub mod index;
pub mod links;
pub mod vault;
pub mod watcher;

pub use calendar::{range_query, CalendarRange, CalendarStore, Event, NoteDate, NoteDateEntry};
pub use document::{Block, Icon, Note, NoteMeta, NoteSummary, SCHEMA_VERSION};
pub use error::{CoreError, Result};
pub use index::{extract_text, SearchHit, SearchIndex};
pub use links::{extract_link_ids, GraphData, GraphEdge, GraphNode, LinkIndex, LINK_INLINE_TYPE};
pub use vault::{AttachmentKind, ChangeEvent, FolderNode, TreeNode, Vault, VaultInfo};
pub use watcher::Watcher;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_list_read_roundtrip() {
        let dir = std::env::temp_dir().join(format!("tundra-test-{}", uuid::Uuid::new_v4()));
        let vault = Vault::open(&dir).unwrap();

        let note = vault.create_note("Photosynthesis").unwrap();
        assert_eq!(note.title, "Photosynthesis");
        assert_eq!(note.schema_version, SCHEMA_VERSION);

        let listed = vault.list_notes().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, note.id);

        let read = vault.read_note(&note.id).unwrap();
        assert_eq!(read.id, note.id);

        std::fs::remove_dir_all(&dir).ok();
    }
}
