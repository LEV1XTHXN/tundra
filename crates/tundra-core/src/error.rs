//! Single error enum for the core, mapped to a typed IPC error the service
//! layer can branch on (CLAUDE.md §8.7 — "define an error strategy in Phase 0").
//!
//! `serde(tag = "kind")` gives the frontend a stable discriminant, so
//! TypeScript can `switch (err.kind)` instead of string-matching messages.

use serde::Serialize;
use specta::Type;

pub type Result<T> = std::result::Result<T, CoreError>;

#[derive(Debug, thiserror::Error, Serialize, Type)]
#[serde(tag = "kind", content = "message")]
pub enum CoreError {
    /// No vault is currently open, or the path is not a usable vault.
    #[error("vault error: {0}")]
    Vault(String),

    /// A requested note could not be found by id.
    #[error("note not found: {0}")]
    NotFound(String),

    /// The stored schema version is newer than this build understands.
    #[error("schema version {found} is newer than supported ({supported})")]
    SchemaTooNew { found: u32, supported: u32 },

    /// Underlying filesystem failure.
    #[error("io error: {0}")]
    Io(String),

    /// JSON (de)serialization failure — a corrupt or malformed note file.
    #[error("data error: {0}")]
    Serde(String),

    /// A block in the tree had an empty `id` (violates the CRDT-ready guarantee).
    #[error("block has an empty id")]
    EmptyBlockId,

    /// The same block `id` appeared more than once in the tree.
    #[error("duplicate block id: {0}")]
    DuplicateBlockId(String),
}

impl From<std::io::Error> for CoreError {
    fn from(e: std::io::Error) -> Self {
        CoreError::Io(e.to_string())
    }
}

impl From<serde_json::Error> for CoreError {
    fn from(e: serde_json::Error) -> Self {
        CoreError::Serde(e.to_string())
    }
}
