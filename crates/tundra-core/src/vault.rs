//! Vault lifecycle & file system — the only module that touches raw FS
//! (CLAUDE.md §6.1 `vault`).
//!
//! Layout (CLAUDE.md §5.2). A note's canonical identity is its UUID *inside the
//! file*, not its path, so links can be repaired when notes move or rename.
//! Writes are atomic (temp file + rename) so the vault — the user's life's work —
//! is never left half-written (CLAUDE.md §8.6).

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use specta::Type;
use walkdir::WalkDir;

use crate::document::{Note, NoteSummary, SCHEMA_VERSION};
use crate::error::{CoreError, Result};

/// Directories created inside a vault on open (CLAUDE.md §5.2).
const DIRS: &[&str] = &[
    ".vault/cache/search",
    ".vault/cache/graph",
    ".vault/config",
    ".vault/dictionaries",
    "notes",
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

/// An open vault rooted at a user-chosen folder.
#[derive(Debug, Clone)]
pub struct Vault {
    root: PathBuf,
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
        Ok(Vault { root })
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

    fn notes_dir(&self) -> PathBuf {
        self.root.join("notes")
    }

    /// Create a new note, persist it, and return it.
    pub fn create_note(&self, title: &str) -> Result<Note> {
        let title = if title.trim().is_empty() {
            "Untitled"
        } else {
            title.trim()
        };
        let note = Note::new(title);
        let path = self.unique_note_path(title);
        self.write_note_at(&path, &note)?;
        Ok(note)
    }

    /// List all notes in the vault (shallow metadata only).
    pub fn list_notes(&self) -> Result<Vec<NoteSummary>> {
        let mut out = Vec::new();
        for entry in WalkDir::new(self.notes_dir())
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            // Skip unreadable/corrupt files rather than failing the whole listing.
            let Ok(note) = self.read_note_at(path) else {
                continue;
            };
            let rel = path
                .strip_prefix(&self.root)
                .unwrap_or(path)
                .to_string_lossy()
                .into_owned();
            out.push(NoteSummary {
                id: note.id,
                title: note.title,
                path: rel,
                modified: note.modified,
            });
        }
        out.sort_by(|a, b| b.modified.cmp(&a.modified));
        Ok(out)
    }

    /// Read a note by its UUID. Identity is the in-file id, so we scan rather
    /// than assume a path — this is what lets notes move/rename freely.
    pub fn read_note(&self, id: &str) -> Result<Note> {
        let path = self
            .path_for_id(id)?
            .ok_or_else(|| CoreError::NotFound(id.to_string()))?;
        self.read_note_at(&path)
    }

    /// Persist an edited note (atomic). Bumps `modified`.
    pub fn save_note(&self, mut note: Note) -> Result<()> {
        note.modified = chrono::Utc::now();
        let path = match self.path_for_id(&note.id)? {
            Some(p) => p,
            None => self.unique_note_path(&note.title),
        };
        self.write_note_at(&path, &note)
    }

    // --- internals -------------------------------------------------------

    fn read_note_at(&self, path: &Path) -> Result<Note> {
        let bytes = fs::read(path)?;
        let note: Note = serde_json::from_slice(&bytes)?;
        if note.schema_version > SCHEMA_VERSION {
            return Err(CoreError::SchemaTooNew {
                found: note.schema_version,
                supported: SCHEMA_VERSION,
            });
        }
        Ok(note)
    }

    /// Atomic write: serialize to a temp file in the same dir, then rename.
    fn write_note_at(&self, path: &Path, note: &Note) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_vec_pretty(note)?;
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, &json)?;
        fs::rename(&tmp, path)?;
        Ok(())
    }

    /// Scan the notes tree for the file whose in-file id matches.
    fn path_for_id(&self, id: &str) -> Result<Option<PathBuf>> {
        for entry in WalkDir::new(self.notes_dir())
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if let Ok(note) = self.read_note_at(path) {
                if note.id == id {
                    return Ok(Some(path.to_path_buf()));
                }
            }
        }
        Ok(None)
    }

    /// Build a filesystem-safe, collision-free path from a title.
    fn unique_note_path(&self, title: &str) -> PathBuf {
        let base = slugify(title);
        let dir = self.notes_dir();
        let mut candidate = dir.join(format!("{base}.json"));
        let mut n = 2;
        while candidate.exists() {
            candidate = dir.join(format!("{base}-{n}.json"));
            n += 1;
        }
        candidate
    }
}

/// Lowercase, spaces→dashes, keep alphanumerics/dash/underscore. Filenames are
/// convenience only; the UUID in the file is the real identity.
fn slugify(title: &str) -> String {
    let mut slug: String = title
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else if c.is_whitespace() {
                '-'
            } else {
                '-'
            }
        })
        .collect();
    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "untitled".to_string()
    } else {
        slug
    }
}
