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

use crate::error::{CoreError, Result};

/// Bump when the on-disk shape changes; migrations key off this (CLAUDE.md §8.10).
pub const SCHEMA_VERSION: u32 = 1;

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
}
