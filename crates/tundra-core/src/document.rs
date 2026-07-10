//! The canonical note / block model (CLAUDE.md §5.3 and the `document` module).
//!
//! CRDT-ready rule: every block carries a stable `id`, and the block tree maps
//! 1:1 onto a future Yjs shared structure. In Phases 1–3 this JSON snapshot is
//! the on-disk format; Phase 4 wraps the same tree in `yrs` with no data-model
//! rewrite. Never let a block lose its `id`.

use std::collections::HashSet;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use uuid::Uuid;

use crate::calendar::NoteDate;
use crate::error::{CoreError, Result};

/// Bump when the on-disk shape changes; migrations key off this (CLAUDE.md §8.10).
///
/// History:
/// - v1: original block tree. Phase 0's skeleton stored a paragraph's text as a
///   raw *string* in `content`.
/// - v2: `content` is BlockNote's array of inline nodes (its real shape). The
///   v1→v2 migration in `Note::migrate` converts the old string form to a single
///   text node so no text is lost.
pub const SCHEMA_VERSION: u32 = 2;

/// A per-note icon: a Twemoji codepoint or a custom vector/image in the vault.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type", content = "value", rename_all = "lowercase")]
pub enum Icon {
    /// Twemoji codepoint string, e.g. `"1f331"`.
    Emoji(String),
    /// Path (relative to the vault) of a custom icon under `attachments/icons/`.
    Custom(String),
}

/// Note-level metadata that is cheap to read and useful for listings.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
pub struct NoteMeta {
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Note→date links (Phase 3 step 1). Optional and `#[serde(default)]`, so old
    /// note files without it load unchanged — no `SCHEMA_VERSION` bump. Mirrored
    /// into `NoteSummary` + the in-memory index (like `pinned`) so calendar range
    /// queries never re-read note files.
    #[serde(default)]
    pub dates: Vec<NoteDate>,
}

/// A single typed block in the note tree.
///
/// `props` and `content` are intentionally free-form JSON: BlockNote owns the
/// editing model (CLAUDE.md §6.1 `document`), so the core stores the block tree
/// faithfully without re-implementing every block type's schema.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Block {
    pub id: String,
    #[serde(rename = "type")]
    pub block_type: String,
    // Exported to TS as `any`: BlockNote owns the block schema, so the core
    // stores this JSON opaquely rather than re-declaring every block type.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(type = Option<specta_typescript::Any>)]
    pub props: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(type = Option<specta_typescript::Any>)]
    pub content: Option<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<Block>,
}

/// A full note document — one JSON file per note.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Note {
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<Icon>,
    pub created: DateTime<Utc>,
    pub modified: DateTime<Utc>,
    #[serde(default)]
    pub meta: NoteMeta,
    #[serde(default)]
    pub blocks: Vec<Block>,
}

impl Note {
    /// Create a new, empty note with a fresh UUID and one empty paragraph so the
    /// editor always opens onto a writable block.
    pub fn new(title: impl Into<String>) -> Self {
        let now = Utc::now();
        Note {
            schema_version: SCHEMA_VERSION,
            id: Uuid::new_v4().to_string(),
            title: title.into(),
            icon: None,
            created: now,
            modified: now,
            meta: NoteMeta::default(),
            blocks: vec![Block {
                id: Uuid::new_v4().to_string(),
                block_type: "paragraph".to_string(),
                props: None,
                content: None,
                children: Vec::new(),
            }],
        }
    }

    /// Enforce the CRDT-ready invariants across the full block tree (blocks +
    /// nested children, recursively): every block's `id` is non-empty, and no
    /// `id` repeats anywhere in the tree. A block can never lose its `id`
    /// (CLAUDE.md §5.3) — this is what makes that guarantee real rather than aspirational.
    pub fn validate(&self) -> Result<()> {
        let mut seen = HashSet::new();
        for block in &self.blocks {
            validate_block(block, &mut seen)?;
        }
        Ok(())
    }

    /// Upgrade an older on-disk note to the current schema, in memory, so the
    /// rest of the app only ever sees the current shape (CLAUDE.md §8.10:
    /// migrations key off `schemaVersion`). Called on every read.
    ///
    /// This is a **lazy** migration: it does not rewrite the file — the upgraded
    /// form is persisted the next time the note is saved. That keeps `open` from
    /// mass-rewriting (and bumping the mtime of) every note in the vault.
    ///
    /// Idempotent: running it on an already-current note is a no-op beyond
    /// stamping `schema_version`.
    pub fn migrate(&mut self) {
        if self.schema_version < 2 {
            // v1 → v2: Phase 0 stored a paragraph's text as a raw string in
            // `content`; BlockNote uses an array of inline nodes, and the editor
            // *discards* any block whose `content` is a string (see
            // `toInitialContent`), which silently lost the text. Convert each
            // string to a single text node so every character is preserved. A
            // block already in the array shape is left untouched.
            for block in &mut self.blocks {
                migrate_string_content_to_inline(block);
            }
        }
        self.schema_version = SCHEMA_VERSION;
    }
}

/// v1→v2 helper: rewrite a block's (and its children's) legacy string `content`
/// into BlockNote's inline shape `[{ "type": "text", "text": <s>, "styles": {} }]`.
/// Only string content is touched; array/absent content is left as-is. The text
/// is preserved verbatim (including any Markdown-looking characters/newlines) —
/// faithfully re-parsing Markdown is the `markdown` module's job, not this
/// data-preserving migration's.
fn migrate_string_content_to_inline(block: &mut Block) {
    if let Some(Value::String(text)) = &block.content {
        block.content = Some(serde_json::json!([
            { "type": "text", "text": text, "styles": {} }
        ]));
    }
    for child in &mut block.children {
        migrate_string_content_to_inline(child);
    }
}

fn validate_block(block: &Block, seen: &mut HashSet<String>) -> Result<()> {
    if block.id.is_empty() {
        return Err(CoreError::EmptyBlockId);
    }
    if !seen.insert(block.id.clone()) {
        return Err(CoreError::DuplicateBlockId(block.id.clone()));
    }
    for child in &block.children {
        validate_block(child, seen)?;
    }
    Ok(())
}

/// Lightweight listing entry for the note tree — avoids loading full block trees.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct NoteSummary {
    pub id: String,
    pub title: String,
    /// Path of the note file relative to the vault root (portable identity aid).
    pub path: String,
    pub modified: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<Icon>,
    /// Mirror of `NoteMeta::pinned`, carried in the summary so listings (the
    /// Home dashboard's Pinned widget, Phase 2 step 6) can filter without
    /// re-reading files.
    #[serde(default)]
    pub pinned: bool,
    /// Mirror of `NoteMeta::dates` (Phase 3 step 1), carried in the summary +
    /// in-memory index so calendar range queries are served without re-reading
    /// note files — the same pattern as `pinned`.
    #[serde(default)]
    pub dates: Vec<NoteDate>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(id: &str, children: Vec<Block>) -> Block {
        Block {
            id: id.to_string(),
            block_type: "paragraph".to_string(),
            props: None,
            content: None,
            children,
        }
    }

    #[test]
    fn validate_passes_on_fresh_note() {
        let note = Note::new("Photosynthesis");
        assert!(note.validate().is_ok());
    }

    #[test]
    fn validate_fails_on_duplicate_id_across_nesting() {
        let mut note = Note::new("Untitled");
        // Duplicate lives inside a nested child, not just at the top level.
        note.blocks = vec![block("a", vec![block("b", vec![])]), block("a", vec![])];
        match note.validate() {
            Err(CoreError::DuplicateBlockId(id)) => assert_eq!(id, "a"),
            other => panic!("expected DuplicateBlockId, got {other:?}"),
        }
    }

    #[test]
    fn validate_fails_on_empty_id() {
        let mut note = Note::new("Untitled");
        note.blocks = vec![block("", vec![])];
        assert!(matches!(note.validate(), Err(CoreError::EmptyBlockId)));
    }

    #[test]
    fn validate_fails_on_empty_id_nested() {
        let mut note = Note::new("Untitled");
        note.blocks = vec![block("a", vec![block("", vec![])])];
        assert!(matches!(note.validate(), Err(CoreError::EmptyBlockId)));
    }

    /// A Phase 0 (v1) block with raw *string* content, as written by the old
    /// textarea skeleton — the shape the editor used to silently discard.
    fn v1_string_block(id: &str, text: &str) -> Block {
        Block {
            id: id.to_string(),
            block_type: "paragraph".to_string(),
            props: None,
            content: Some(Value::String(text.to_string())),
            children: Vec::new(),
        }
    }

    #[test]
    fn migrate_v1_string_content_becomes_a_text_node_preserving_text() {
        let mut note = Note::new("Legacy");
        note.schema_version = 1;
        note.blocks = vec![v1_string_block("b1", "note note note\n\n# Note \n\nHello")];

        note.migrate();

        assert_eq!(note.schema_version, SCHEMA_VERSION);
        let expected = serde_json::json!([
            { "type": "text", "text": "note note note\n\n# Note \n\nHello", "styles": {} }
        ]);
        assert_eq!(note.blocks[0].content.as_ref().unwrap(), &expected);
    }

    #[test]
    fn migrate_recurses_into_children() {
        let mut note = Note::new("Nested");
        note.schema_version = 1;
        let mut parent = v1_string_block("p", "parent text");
        parent.children = vec![v1_string_block("c", "child text")];
        note.blocks = vec![parent];

        note.migrate();

        assert_eq!(
            note.blocks[0].children[0].content.as_ref().unwrap(),
            &serde_json::json!([{ "type": "text", "text": "child text", "styles": {} }])
        );
    }

    #[test]
    fn migrate_is_a_noop_for_already_current_array_content() {
        // A v2 note whose content is already BlockNote's inline array must be
        // left byte-for-byte identical (only the version stamp is idempotent).
        let mut note = Note::new("Modern");
        let array = serde_json::json!([{ "type": "text", "text": "hi", "styles": {} }]);
        note.blocks[0].content = Some(array.clone());

        note.migrate();

        assert_eq!(note.schema_version, SCHEMA_VERSION);
        assert_eq!(note.blocks[0].content.as_ref().unwrap(), &array);
    }

    #[test]
    fn migrate_leaves_contentless_blocks_alone() {
        // Fresh notes have `content: None` — nothing to convert, just re-stamp.
        let mut note = Note::new("Empty");
        note.schema_version = 1;
        note.migrate();
        assert_eq!(note.schema_version, SCHEMA_VERSION);
        assert!(note.blocks[0].content.is_none());
    }
}
