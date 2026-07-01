//! The canonical note / block model (CLAUDE.md §5.3 and the `document` module).
//!
//! CRDT-ready rule: every block carries a stable `id`, and the block tree maps
//! 1:1 onto a future Yjs shared structure. In Phases 1–3 this JSON snapshot is
//! the on-disk format; Phase 4 wraps the same tree in `yrs` with no data-model
//! rewrite. Never let a block lose its `id`.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use uuid::Uuid;

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
}

/// Lightweight listing entry for the note tree — avoids loading full block trees.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct NoteSummary {
    pub id: String,
    pub title: String,
    /// Path of the note file relative to the vault root (portable identity aid).
    pub path: String,
    pub modified: DateTime<Utc>,
}
