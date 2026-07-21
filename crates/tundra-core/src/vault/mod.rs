//! Vault lifecycle & file system — the only module that touches raw FS
//! (CLAUDE.md §6.1 `vault`).
//!
//! Layout (CLAUDE.md §5.2). A note's canonical identity is its UUID *inside the
//! file*, not its path, so links can be repaired when notes move or rename.
//! Writes are atomic (temp file + rename) so the vault — the user's life's work —
//! is never left half-written (CLAUDE.md §8.6).
//!
//! Scale target: Phase 1 designs for a ~50k-note vault (Phase 1 preamble). The
//! in-memory `id -> path/summary` index below is what makes open/save/list
//! O(1)/O(log n) instead of an O(N) walk-and-parse of every note file.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::SystemTime;

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use specta::Type;
use walkdir::WalkDir;

use crate::calendar::{NoteDate, NoteDateEntry};
use crate::document::{Note, NoteSummary, SCHEMA_VERSION};
use crate::error::{CoreError, Result};

/// Directories created inside a vault on open (CLAUDE.md §5.2).
const DIRS: &[&str] = &[
    ".vault/cache/search",
    ".vault/cache/graph",
    ".vault/config",
    ".vault/dictionaries",
    "notes",
    "templates",
    "attachments/images",
    "attachments/videos",
    "attachments/files",
    "attachments/icons",
];

/// Summary of an open vault handed back across the IPC boundary.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct VaultInfo {
    /// Display name (the vault folder's file name).
    pub name: String,
    /// Absolute path to the vault root.
    pub path: String,
}

/// Lightweight listing entry for a reusable note template (see the `templates`
/// section on `Vault`). Templates are `Note`-shaped documents kept OUTSIDE
/// `notes/` (under the vault's `templates/` directory), so they never appear in
/// the note tree, search, links, or graph — the same "not one of the vault's
/// notes" treatment as the quick-note scratchpad. Only the cheap-to-show fields
/// are carried across the boundary; the full block tree is loaded on demand via
/// `read_template`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TemplateSummary {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<crate::document::Icon>,
}

/// Which attachment library an import lands in (CLAUDE.md §5.2:
/// `attachments/{images,videos,files}`). Crosses the IPC boundary, so it is
/// serialized; the frontend maps a file's MIME type onto one of these.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum AttachmentKind {
    Image,
    Video,
    File,
}

impl AttachmentKind {
    /// The `attachments/` subdirectory this kind stores into.
    fn subdir(self) -> &'static str {
        match self {
            AttachmentKind::Image => "images",
            AttachmentKind::Video => "videos",
            AttachmentKind::File => "files",
        }
    }
}

/// A folder/note tree node, as served by `list_tree` (built from the
/// in-memory index — no disk reads beyond what `Vault::open` already did).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", content = "data")]
pub enum TreeNode {
    Folder(FolderNode),
    Note(NoteSummary),
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct FolderNode {
    pub name: String,
    /// Forward-slash-separated path relative to the notes root, e.g.
    /// `"Biology/Plants"` — the same shape every folder-op command takes.
    pub path: String,
    pub children: Vec<TreeNode>,
}

/// One entry in the in-memory index: where a note lives and its cheap-to-read
/// summary, kept in sync on every create/save/move/delete.
#[derive(Debug, Clone)]
struct IndexEntry {
    path: PathBuf,
    summary: NoteSummary,
}

/// The full in-memory index for an open vault.
///
/// Built once by a single walk in `Vault::open`. A future optimization could
/// persist a stub of this under `.vault/cache/` (derived, rebuildable — never
/// a source of truth) so a reopen can skip the walk entirely; that cache
/// doesn't exist yet, so `open` always rebuilds from disk. This struct is the
/// seam where that would plug in later.
#[derive(Debug, Default)]
struct VaultIndex {
    /// id -> where it lives + its summary.
    notes: HashMap<String, IndexEntry>,
    /// Every folder path (relative to `notes/`), including empty ones, so
    /// `list_tree` can show folders that contain no notes yet.
    folders: BTreeSet<PathBuf>,
}

/// An open vault rooted at a user-chosen folder.
///
/// Cheap to clone: the index and self-write registry are shared (`Arc<RwLock<_>>`)
/// across clones, which matters because `Vault` is cloned out of managed Tauri
/// state on every command (CLAUDE.md `ipc` module) rather than locked in place.
#[derive(Debug, Clone)]
pub struct Vault {
    root: PathBuf,
    index: Arc<RwLock<VaultIndex>>,
    /// (path -> mtime) recorded for every write this vault performs, so a
    /// future file watcher (Phase 1 step 8) can recognize and skip the app's
    /// own writes instead of reacting to them as external changes. Scoped to
    /// note-content writes (create/save) — structural ops (move/delete/folder
    /// ops) are a separate concern the watcher will need to handle on its own.
    self_writes: Arc<RwLock<HashMap<PathBuf, SystemTime>>>,
}

impl Vault {
    /// Open a vault at `path`, creating the standard layout if missing.
    /// This doubles as "create vault" — the on-disk format is identical whether
    /// the folder is brand-new or pre-existing (CLAUDE.md §5.1).
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let root = path.as_ref().to_path_buf();
        if root.exists() && !root.is_dir() {
            return Err(CoreError::Vault(format!(
                "{} exists but is not a directory",
                root.display()
            )));
        }
        for dir in DIRS {
            fs::create_dir_all(root.join(dir))?;
        }
        let index = build_index(&root)?;
        Ok(Vault {
            root,
            index: Arc::new(RwLock::new(index)),
            self_writes: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    pub fn info(&self) -> VaultInfo {
        let name = self
            .root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Vault".to_string());
        VaultInfo {
            name,
            path: self.root.to_string_lossy().into_owned(),
        }
    }

    pub(crate) fn notes_dir(&self) -> PathBuf {
        self.root.join("notes")
    }

    /// The vault's root directory on disk — used by whole-vault features like
    /// `backup` that need to walk every file. Read-only; all writes still go
    /// through the vault's atomic helpers.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Vault-relative path as a portable, forward-slash-separated string —
    /// crosses the IPC boundary, so it must never carry Windows' native `\`
    /// separator (the frontend and stored block props compare/prefix-match
    /// these as plain `/`-separated strings, e.g. `resolveFileUrl`'s
    /// `startsWith("attachments/")`).
    fn rel_to_root(&self, path: &Path) -> String {
        path.strip_prefix(&self.root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/")
    }

    fn rel_to_notes(&self, path: &Path) -> PathBuf {
        path.strip_prefix(self.notes_dir())
            .unwrap_or(path)
            .to_path_buf()
    }
}

/// What changed on disk, as told to the frontend (Phase 1 step 8). Produced
/// by `Vault::reconcile_path`, consumed by the `watcher` module's caller
/// (the Tauri layer maps these onto typed events).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChangeEvent {
    /// The folder/note tree changed shape, or a note's title/icon changed —
    /// the frontend should refresh the nav tree.
    TreeChanged,
    /// This note's content changed on disk, not caused by our own write —
    /// the frontend applies the clean/dirty/deleted reconciliation policy if
    /// it's the currently open note.
    NoteChangedExternally { id: String },
}

mod attachments;
mod config;
mod dates;
mod folders;
mod indexing;
mod notes;
mod paths;
mod quicknotes;
mod tags;
mod templates;
mod watch;

use indexing::*;
use paths::*;

#[cfg(test)]
mod tests;
