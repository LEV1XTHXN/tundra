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

    fn rel_to_root(&self, path: &Path) -> String {
        path.strip_prefix(&self.root)
            .unwrap_or(path)
            .to_string_lossy()
            .into_owned()
    }

    fn rel_to_notes(&self, path: &Path) -> PathBuf {
        path.strip_prefix(self.notes_dir())
            .unwrap_or(path)
            .to_path_buf()
    }

    /// Create a new note, persist it, and return it.
    pub fn create_note(&self, title: &str) -> Result<Note> {
        self.create_note_in(title, "")
    }

    /// Create a new note directly inside `folder_rel` (relative to `notes/`,
    /// `""` for the root) — one write, no separate create-then-move.
    pub fn create_note_in(&self, title: &str, folder_rel: &str) -> Result<Note> {
        let title = if title.trim().is_empty() {
            "Untitled"
        } else {
            title.trim()
        };
        let note = Note::new(title);
        let dir = self.abs_folder_path(folder_rel);
        fs::create_dir_all(&dir)?;
        let path = first_available(&dir, &slugify(title));
        self.write_note_at(&path, &note)?;

        let summary = NoteSummary {
            id: note.id.clone(),
            title: note.title.clone(),
            path: self.rel_to_root(&path),
            modified: note.modified,
            icon: note.icon.clone(),
        };
        self.index
            .write()
            .unwrap()
            .notes
            .insert(note.id.clone(), IndexEntry { path, summary });
        Ok(note)
    }

    /// List all notes in the vault (shallow metadata only) — served entirely
    /// from the in-memory index, no disk reads.
    pub fn list_notes(&self) -> Result<Vec<NoteSummary>> {
        let index = self.index.read().unwrap();
        let mut out: Vec<NoteSummary> = index.notes.values().map(|e| e.summary.clone()).collect();
        out.sort_by(|a, b| b.modified.cmp(&a.modified));
        Ok(out)
    }

    /// The current summary for a single note, if it exists — served from the
    /// index like `list_notes`, no disk read. Used by the Tauri layer to get
    /// a note's current vault-relative path for search indexing.
    pub fn note_summary(&self, id: &str) -> Option<NoteSummary> {
        self.index.read().unwrap().notes.get(id).map(|e| e.summary.clone())
    }

    /// The folder/note tree, built from the in-memory index (no disk reads).
    pub fn list_tree(&self) -> Vec<TreeNode> {
        let index = self.index.read().unwrap();
        let mut root = FolderAccum::default();

        // Every known folder is a node, even ones with no notes in them yet.
        for folder in &index.folders {
            get_or_create(&mut root, folder);
        }
        for entry in index.notes.values() {
            let rel = self.rel_to_notes(&entry.path);
            let parent = rel.parent().unwrap_or_else(|| Path::new(""));
            get_or_create(&mut root, parent)
                .notes
                .push(entry.summary.clone());
        }

        to_tree_nodes(root, "")
    }

    /// Read a note by its UUID — an O(1) index lookup, then one disk read for
    /// the full block tree (summaries never carry the body, so this is the
    /// only place a note's content is actually loaded).
    pub fn read_note(&self, id: &str) -> Result<Note> {
        let path = {
            let index = self.index.read().unwrap();
            index.notes.get(id).map(|e| e.path.clone())
        }
        .ok_or_else(|| CoreError::NotFound(id.to_string()))?;
        read_note_at(&path)
    }

    /// Persist an edited note (atomic). Bumps `modified`. Never renames the
    /// file — the on-disk name is frozen at creation; only the id-matched path
    /// looked up here is written back to.
    pub fn save_note(&self, mut note: Note) -> Result<()> {
        // Reject malformed block trees before touching the filesystem at all
        // (CLAUDE.md Phase 1 preamble: never persist a note that breaks the
        // CRDT-ready block-id invariants).
        note.validate()?;
        note.modified = chrono::Utc::now();

        let existing = {
            let index = self.index.read().unwrap();
            index.notes.get(&note.id).map(|e| e.path.clone())
        };
        let path = match existing {
            Some(p) => p,
            None => self.unique_note_path(&note.title),
        };
        self.write_note_at(&path, &note)?;

        let summary = NoteSummary {
            id: note.id.clone(),
            title: note.title.clone(),
            path: self.rel_to_root(&path),
            modified: note.modified,
            icon: note.icon.clone(),
        };
        self.index
            .write()
            .unwrap()
            .notes
            .insert(note.id.clone(), IndexEntry { path, summary });
        Ok(())
    }

    /// Delete a note by id: removes the file (and any rolling `.bak`) and
    /// drops it from the index.
    pub fn delete_note(&self, id: &str) -> Result<()> {
        let path = {
            let index = self.index.read().unwrap();
            index.notes.get(id).map(|e| e.path.clone())
        }
        .ok_or_else(|| CoreError::NotFound(id.to_string()))?;

        fs::remove_file(&path)?;
        let _ = fs::remove_file(path.with_extension("json.bak"));

        self.index.write().unwrap().notes.remove(id);
        Ok(())
    }

    /// Move a note to a different folder (relative to `notes/`, e.g.
    /// `"Biology/Plants"` or `""` for the root). Preserves the file's base
    /// name and, above all, its in-file id — identity survives the move.
    pub fn move_note(&self, id: &str, new_folder_rel: &str) -> Result<()> {
        let old_path = {
            let index = self.index.read().unwrap();
            index.notes.get(id).map(|e| e.path.clone())
        }
        .ok_or_else(|| CoreError::NotFound(id.to_string()))?;

        let new_dir = self.abs_folder_path(new_folder_rel);
        fs::create_dir_all(&new_dir)?;
        let stem = old_path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .ok_or_else(|| CoreError::Vault("note path has no file name".into()))?;
        let new_path = first_available(&new_dir, &stem);

        fs::rename(&old_path, &new_path)?;

        let rel = self.rel_to_root(&new_path);
        let mut index = self.index.write().unwrap();
        if let Some(entry) = index.notes.get_mut(id) {
            entry.path = new_path;
            entry.summary.path = rel;
        }
        Ok(())
    }

    /// Create a folder (and any missing parents) under `notes/`. Idempotent.
    pub fn create_folder(&self, rel: &str) -> Result<()> {
        let abs = self.abs_folder_path(rel);
        fs::create_dir_all(&abs)?;
        let rel_path = self.rel_to_notes(&abs);
        self.index.write().unwrap().folders.insert(rel_path);
        Ok(())
    }

    /// Rename a folder in place (same parent, new leaf name). Notes beneath it
    /// keep their id; only on-disk paths and the index are rewritten.
    pub fn rename_folder(&self, rel: &str, new_name: &str) -> Result<()> {
        if is_root(rel) {
            return Err(CoreError::Vault("cannot rename the notes root".into()));
        }
        let old_abs = self.abs_folder_path(rel);
        if !old_abs.is_dir() {
            return Err(CoreError::NotFound(rel.to_string()));
        }
        let parent = old_abs
            .parent()
            .ok_or_else(|| CoreError::Vault("cannot rename the notes root".into()))?;
        let new_abs = parent.join(new_name);
        if new_abs.exists() {
            return Err(CoreError::Vault(format!(
                "a folder or file named \"{new_name}\" already exists there"
            )));
        }
        fs::rename(&old_abs, &new_abs)?;
        self.reindex_subtree(&old_abs, &new_abs);
        Ok(())
    }

    /// Move a folder (and everything beneath it) under a different parent
    /// folder, keeping its own name.
    pub fn move_folder(&self, rel: &str, new_parent_rel: &str) -> Result<()> {
        if is_root(rel) {
            return Err(CoreError::Vault("cannot move the notes root".into()));
        }
        let old_abs = self.abs_folder_path(rel);
        if !old_abs.is_dir() {
            return Err(CoreError::NotFound(rel.to_string()));
        }
        let name = old_abs
            .file_name()
            .ok_or_else(|| CoreError::Vault("folder path has no name".into()))?
            .to_owned();
        let new_parent_abs = self.abs_folder_path(new_parent_rel);
        fs::create_dir_all(&new_parent_abs)?;
        let new_abs = new_parent_abs.join(&name);
        if new_abs.starts_with(&old_abs) {
            return Err(CoreError::Vault("cannot move a folder into itself".into()));
        }
        if new_abs.exists() {
            return Err(CoreError::Vault(
                "a folder or file with that name already exists there".into(),
            ));
        }
        fs::rename(&old_abs, &new_abs)?;
        self.reindex_subtree(&old_abs, &new_abs);
        Ok(())
    }

    /// Delete a folder. **This recursively deletes every note and subfolder
    /// beneath it** — there is no separate "must be empty" mode. Callers at
    /// the command/UI layer are responsible for confirming this with the user
    /// first (Phase 1 step 6 adds that confirmation UI); the vault layer
    /// itself performs the deletion unconditionally once asked.
    pub fn delete_folder(&self, rel: &str) -> Result<()> {
        if is_root(rel) {
            return Err(CoreError::Vault("cannot delete the notes root".into()));
        }
        let abs = self.abs_folder_path(rel);
        if !abs.is_dir() {
            return Err(CoreError::NotFound(rel.to_string()));
        }
        fs::remove_dir_all(&abs)?;

        let rel_path = self.rel_to_notes(&abs);
        let mut index = self.index.write().unwrap();
        index.notes.retain(|_, e| !e.path.starts_with(&abs));
        index
            .folders
            .retain(|f| *f != rel_path && !f.starts_with(&rel_path));
        Ok(())
    }

    /// Query without consuming: the mtime this vault recorded for its own
    /// write to `path`, if any.
    pub fn peek_self_write(&self, path: &Path) -> Option<SystemTime> {
        self.self_writes.read().unwrap().get(path).copied()
    }

    /// Query-and-consume: remove and return the recorded self-write for
    /// `path`, if any. The Phase 1 step 8 file watcher calls this once per
    /// raw file event so a matched entry isn't reused for a later, genuinely
    /// external change to the same path.
    pub fn consume_self_write(&self, path: &Path) -> Option<SystemTime> {
        self.self_writes.write().unwrap().remove(path)
    }

    // --- internals -------------------------------------------------------

    /// Atomic write: temp file (same directory) -> fsync the temp file ->
    /// atomic replace over the target -> fsync the parent directory. Keeps a
    /// single rolling `.bak` of whatever was previously at `path`. Uses
    /// `tempfile`'s `persist`, which is `ReplaceFile` on Windows and `rename`
    /// on Unix, so an existing target is replaced safely either way. If any
    /// step fails, the temp file is cleaned up automatically (it's dropped
    /// on error) and the file at `path` — if it existed — is left untouched.
    fn write_note_at(&self, path: &Path, note: &Note) -> Result<()> {
        let parent = path
            .parent()
            .ok_or_else(|| CoreError::Vault("note path has no parent directory".into()))?;
        fs::create_dir_all(parent)?;
        let json = serde_json::to_vec_pretty(note)?;

        let mut tmp = tempfile::Builder::new()
            .prefix(".tundra-tmp-")
            .suffix(".tmp")
            .tempfile_in(parent)?;
        tmp.write_all(&json)?;
        tmp.as_file().sync_all()?;

        if path.exists() {
            let _ = fs::copy(path, path.with_extension("json.bak"));
        }

        tmp.persist(path).map_err(|e| CoreError::Io(e.to_string()))?;
        sync_dir(parent);

        self.record_self_write(path)?;
        Ok(())
    }

    fn record_self_write(&self, path: &Path) -> Result<()> {
        let mtime = fs::metadata(path)?.modified()?;
        self.self_writes
            .write()
            .unwrap()
            .insert(path.to_path_buf(), mtime);
        Ok(())
    }

    /// Resolve a `/`-separated folder path (relative to `notes/`) to an
    /// absolute path. `""` (or any all-slash string) means the notes root.
    fn abs_folder_path(&self, rel: &str) -> PathBuf {
        let mut p = self.notes_dir();
        for comp in rel.split('/').filter(|c| !c.is_empty()) {
            p.push(comp);
        }
        p
    }

    /// After a folder rename/move on disk, rewrite every affected note path
    /// and folder-set entry from the old prefix to the new one.
    fn reindex_subtree(&self, old_abs: &Path, new_abs: &Path) {
        let notes_dir = self.notes_dir();
        let mut index = self.index.write().unwrap();

        for entry in index.notes.values_mut() {
            if let Ok(suffix) = entry.path.strip_prefix(old_abs) {
                let new_path = new_abs.join(suffix);
                entry.summary.path = new_path
                    .strip_prefix(&self.root)
                    .unwrap_or(&new_path)
                    .to_string_lossy()
                    .into_owned();
                entry.path = new_path;
            }
        }

        let old_rel = old_abs.strip_prefix(&notes_dir).unwrap_or(old_abs);
        let new_rel = new_abs.strip_prefix(&notes_dir).unwrap_or(new_abs);
        let affected: Vec<PathBuf> = index
            .folders
            .iter()
            .filter(|f| f.as_path() == old_rel || f.starts_with(old_rel))
            .cloned()
            .collect();
        for f in affected {
            index.folders.remove(&f);
            if let Ok(suffix) = f.strip_prefix(old_rel) {
                index.folders.insert(new_rel.join(suffix));
            }
        }
    }

    /// Build a filesystem-safe, collision-free path from a title.
    fn unique_note_path(&self, title: &str) -> PathBuf {
        first_available(&self.notes_dir(), &slugify(title))
    }

    /// Copy `src_path` (anywhere on disk — e.g. the user's Pictures folder)
    /// into `attachments/icons/`, returning its path relative to the vault
    /// root for `Icon::Custom`. Collisions get a numeric suffix, same as note
    /// filenames.
    pub fn import_icon(&self, src_path: &Path) -> Result<String> {
        let icons_dir = self.root.join("attachments/icons");
        fs::create_dir_all(&icons_dir)?;

        let stem = src_path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "icon".to_string());
        let ext = src_path.extension().map(|e| e.to_string_lossy().into_owned());
        let dest = first_available_with_ext(&icons_dir, &stem, ext.as_deref());

        fs::copy(src_path, &dest)?;
        Ok(self.rel_to_root(&dest))
    }

    /// Import an attachment by **content** (Phase 2 step 1): hash the bytes with
    /// blake3, store them at `attachments/<kind>/<aa>/<hash>.<ext>` — sharded by
    /// the first two hex chars of the hash — and return the path relative to the
    /// vault root, which the caller stores in the embedding block.
    ///
    /// Content-addressed, so **identical content dedupes automatically**: the
    /// same bytes always map to the same path, and if that file already exists
    /// the write is skipped. The write itself is atomic (temp file + rename) so a
    /// hashed path never names a torn/partial file. The original filename is not
    /// part of the path — the caller keeps it in the block for display/download.
    ///
    /// This is the byte-fed generalization of `import_icon`: attachments arrive
    /// from the editor as in-memory bytes (a browser `File`), not a filesystem
    /// path, so all FS work still happens here in the core — never the frontend.
    pub fn import_attachment(
        &self,
        kind: AttachmentKind,
        file_name: &str,
        bytes: &[u8],
    ) -> Result<String> {
        let hex = blake3::hash(bytes).to_hex();
        let shard = &hex[..2];
        let dir = self
            .root
            .join("attachments")
            .join(kind.subdir())
            .join(shard);
        fs::create_dir_all(&dir)?;

        // Keep the original extension so the asset protocol serves the right
        // Content-Type (the webview needs it to render <img>/<video>).
        let ext = Path::new(file_name)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase());
        let name = match &ext {
            Some(e) => format!("{hex}.{e}"),
            None => hex.to_string(),
        };
        let dest = dir.join(&name);

        // Dedupe: identical content is already stored — nothing to write.
        if !dest.exists() {
            let mut tmp = tempfile::Builder::new()
                .prefix(".att-tmp-")
                .tempfile_in(&dir)?;
            tmp.write_all(bytes)?;
            tmp.as_file().sync_all()?;
            tmp.persist(&dest).map_err(|e| CoreError::Io(e.to_string()))?;
        }
        Ok(self.rel_to_root(&dest))
    }

    /// Read a vault-scoped config file under `.vault/config/<name>`, returning
    /// its raw contents (a JSON string the caller parses) or `None` if it
    /// doesn't exist yet. Vault-scoped UI state — graph view settings
    /// (`graph-view.json`, Phase 2 step 4), the home dashboard layout
    /// (`home.json`, step 6) — lives here, NOT in `localStorage` (CLAUDE.md
    /// §4 blacklist; §5.2 `.vault/config` MAY sync). `name` is validated to a
    /// bare filename so an untrusted caller can't escape the config directory.
    pub fn read_config(&self, name: &str) -> Result<Option<String>> {
        let path = self.config_path(name)?;
        match fs::read_to_string(&path) {
            Ok(s) => Ok(Some(s)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Write a vault-scoped config file under `.vault/config/<name>` atomically
    /// (temp file + rename), same durability discipline as note writes — config
    /// is small but a torn write would still corrupt a user's layout/settings.
    pub fn write_config(&self, name: &str, contents: &str) -> Result<()> {
        let path = self.config_path(name)?;
        let dir = path
            .parent()
            .ok_or_else(|| CoreError::Vault("config path has no parent directory".into()))?;
        fs::create_dir_all(dir)?;

        let mut tmp = tempfile::Builder::new()
            .prefix(".cfg-tmp-")
            .tempfile_in(dir)?;
        tmp.write_all(contents.as_bytes())?;
        tmp.as_file().sync_all()?;
        tmp.persist(&path).map_err(|e| CoreError::Io(e.to_string()))?;
        sync_dir(dir);
        Ok(())
    }

    /// Resolve `.vault/config/<name>`, rejecting anything that isn't a bare
    /// filename (no separators, no `..`, no absolute paths) so a config `name`
    /// crossing the IPC boundary can never traverse out of the config dir.
    fn config_path(&self, name: &str) -> Result<PathBuf> {
        let ok = !name.is_empty()
            && name != "."
            && name != ".."
            && !name.contains('/')
            && !name.contains('\\')
            && !name.contains('\0');
        if !ok {
            return Err(CoreError::Vault(format!("invalid config name: {name:?}")));
        }
        Ok(self.root.join(".vault/config").join(name))
    }

    /// Reconcile a single raw filesystem path inside `notes/` that changed —
    /// already confirmed not to be one of this vault's own writes (see
    /// `consume_self_write`) — against the in-memory index, updating it and
    /// returning what the outside world should be told (Phase 1 step 8).
    ///
    /// Deliberately path-existence-driven rather than trusting the raw
    /// `notify` event kind: on Windows a rename is often reported as a
    /// delete+create pair, and reacting to "does this path exist, and what's
    /// in it" converges to the correct state regardless of event ordering or
    /// how a rename got coalesced.
    pub fn reconcile_path(&self, path: &Path) -> Vec<ChangeEvent> {
        let mut events = Vec::new();
        let is_json = path.extension().and_then(|e| e.to_str()) == Some("json");

        if is_json {
            if path.is_file() {
                // Ignore a corrupt/partial read (e.g. we caught the file
                // mid-write in an external editor) — a later settling event
                // for the same path will resolve it once the write completes.
                if let Ok(note) = read_note_at(path) {
                    let summary = NoteSummary {
                        id: note.id.clone(),
                        title: note.title.clone(),
                        path: self.rel_to_root(path),
                        modified: note.modified,
                        icon: note.icon.clone(),
                    };
                    self.index.write().unwrap().notes.insert(
                        note.id.clone(),
                        IndexEntry {
                            path: path.to_path_buf(),
                            summary,
                        },
                    );
                    events.push(ChangeEvent::TreeChanged);
                    events.push(ChangeEvent::NoteChangedExternally { id: note.id });
                }
            } else {
                // Removed (or renamed away): find whichever id, if any, was
                // indexed at exactly this path — we can no longer read the
                // file to learn its id.
                let mut index = self.index.write().unwrap();
                let removed_id = index
                    .notes
                    .iter()
                    .find(|(_, e)| e.path == path)
                    .map(|(id, _)| id.clone());
                if let Some(id) = removed_id {
                    index.notes.remove(&id);
                    drop(index);
                    events.push(ChangeEvent::TreeChanged);
                    events.push(ChangeEvent::NoteChangedExternally { id });
                }
            }
            return events;
        }

        // Not a note file: only react if it is (or was) a folder we track,
        // so stray non-json artifacts (our own atomic-write .tmp/.bak, or
        // unrelated files a user drops in) are silently ignored.
        let rel = self.rel_to_notes(path);
        if rel.as_os_str().is_empty() {
            return events; // the notes/ root itself
        }
        let mut index = self.index.write().unwrap();
        let changed = if path.is_dir() {
            index.folders.insert(rel.clone())
        } else if index.folders.contains(&rel) {
            index.folders.remove(&rel);
            index.folders.retain(|f| !f.starts_with(&rel));
            true
        } else {
            false
        };
        drop(index);
        if changed {
            events.push(ChangeEvent::TreeChanged);
        }
        events
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

fn is_root(rel: &str) -> bool {
    rel.split('/').all(|c| c.is_empty())
}

/// First path of the form `{dir}/{base}.json`, `{dir}/{base}-2.json`, ... that
/// doesn't already exist.
fn first_available(dir: &Path, base: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{base}.json"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{base}-{n}.json"));
        n += 1;
    }
    candidate
}

/// Like `first_available`, but for an arbitrary (optional) extension instead
/// of always `.json` — used for imported icon files.
fn first_available_with_ext(dir: &Path, stem: &str, ext: Option<&str>) -> PathBuf {
    let suffix = ext.map(|e| format!(".{e}")).unwrap_or_default();
    let mut candidate = dir.join(format!("{stem}{suffix}"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}-{n}{suffix}"));
        n += 1;
    }
    candidate
}

/// Best-effort fsync of a directory so a preceding rename/replace is durable
/// across a crash, not merely atomic. Unix supports opening a directory for
/// this; Windows has no portable equivalent via `std`, so this is a no-op
/// there — the replace operation itself (`ReplaceFile`) is still atomic.
#[cfg(unix)]
fn sync_dir(dir: &Path) {
    if let Ok(d) = fs::File::open(dir) {
        let _ = d.sync_all();
    }
}

#[cfg(not(unix))]
fn sync_dir(_dir: &Path) {}

fn read_note_at(path: &Path) -> Result<Note> {
    let bytes = fs::read(path)?;
    let mut note: Note = serde_json::from_slice(&bytes)?;
    if note.schema_version > SCHEMA_VERSION {
        return Err(CoreError::SchemaTooNew {
            found: note.schema_version,
            supported: SCHEMA_VERSION,
        });
    }
    // Upgrade older on-disk notes to the current shape before anyone sees them
    // (lazy — persisted on the next save). This is the single choke point every
    // read passes through (direct reads and the `build_index` walk both land here).
    note.migrate();
    Ok(note)
}

/// Single pass over `notes/` building the id -> {path, summary} index and the
/// set of known folders (including empty ones). This is the one place a fresh
/// `Vault::open` pays an O(N) cost; everything afterward is served from here.
fn build_index(root: &Path) -> Result<VaultIndex> {
    let notes_dir = root.join("notes");
    let mut idx = VaultIndex::default();

    for entry in WalkDir::new(&notes_dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path == notes_dir {
            continue;
        }
        if entry.file_type().is_dir() {
            if let Ok(rel) = path.strip_prefix(&notes_dir) {
                idx.folders.insert(rel.to_path_buf());
            }
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        // Skip unreadable/corrupt files rather than failing the whole open.
        let Ok(note) = read_note_at(path) else {
            continue;
        };
        let rel_to_root = path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .into_owned();
        idx.notes.insert(
            note.id.clone(),
            IndexEntry {
                path: path.to_path_buf(),
                summary: NoteSummary {
                    id: note.id,
                    title: note.title,
                    path: rel_to_root,
                    modified: note.modified,
                    icon: note.icon,
                },
            },
        );
    }
    Ok(idx)
}

/// In-progress folder/note accumulator used only while building `list_tree`'s
/// output; not exposed outside this module.
#[derive(Default)]
struct FolderAccum {
    notes: Vec<NoteSummary>,
    subfolders: BTreeMap<String, FolderAccum>,
}

fn get_or_create<'a>(root: &'a mut FolderAccum, rel: &Path) -> &'a mut FolderAccum {
    let mut node = root;
    for comp in rel.iter() {
        let name = comp.to_string_lossy().into_owned();
        node = node.subfolders.entry(name).or_default();
    }
    node
}

fn to_tree_nodes(node: FolderAccum, prefix: &str) -> Vec<TreeNode> {
    let mut out: Vec<TreeNode> = node
        .subfolders
        .into_iter()
        .map(|(name, child)| {
            let path = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            let children = to_tree_nodes(child, &path);
            TreeNode::Folder(FolderNode {
                name,
                path,
                children,
            })
        })
        .collect();

    let mut notes = node.notes;
    notes.sort_by(|a, b| a.title.cmp(&b.title));
    out.extend(notes.into_iter().map(TreeNode::Note));
    out
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::{Block, Icon};

    fn temp_vault() -> (Vault, PathBuf) {
        let dir = std::env::temp_dir().join(format!("tundra-vault-test-{}", uuid::Uuid::new_v4()));
        (Vault::open(&dir).unwrap(), dir)
    }

    #[test]
    fn save_note_rejects_invalid_note_and_writes_nothing() {
        let (vault, dir) = temp_vault();
        let mut note = vault.create_note("Bad Note").unwrap();
        // Corrupt the block tree: duplicate the sole block's id.
        let dup = note.blocks[0].clone();
        note.blocks.push(dup);

        let err = vault.save_note(note.clone()).unwrap_err();
        assert!(matches!(err, CoreError::DuplicateBlockId(_)));

        // The prior valid version on disk must be untouched, and no .tmp left behind.
        let reread = vault.read_note(&note.id).unwrap();
        assert_eq!(reread.blocks.len(), 1);
        let notes_dir = dir.join("notes");
        for entry in std::fs::read_dir(&notes_dir).unwrap() {
            let path = entry.unwrap().path();
            assert_ne!(path.extension().and_then(|e| e.to_str()), Some("tmp"));
        }

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_note_rejects_empty_block_id() {
        let (vault, dir) = temp_vault();
        let mut note = vault.create_note("Another Note").unwrap();
        note.blocks = vec![Block {
            id: String::new(),
            block_type: "paragraph".to_string(),
            props: None,
            content: None,
            children: Vec::new(),
        }];

        let err = vault.save_note(note).unwrap_err();
        assert!(matches!(err, CoreError::EmptyBlockId));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn index_reflects_create_save_move_delete() {
        let (vault, dir) = temp_vault();

        let a = vault.create_note("Alpha").unwrap();
        let b = vault.create_note("Beta").unwrap();
        assert_eq!(vault.list_notes().unwrap().len(), 2);

        let mut edited = vault.read_note(&a.id).unwrap();
        edited.title = "Alpha Renamed".to_string();
        vault.save_note(edited).unwrap();
        let summary = vault
            .list_notes()
            .unwrap()
            .into_iter()
            .find(|s| s.id == a.id)
            .unwrap();
        assert_eq!(summary.title, "Alpha Renamed");

        vault.create_folder("Folder").unwrap();
        vault.move_note(&b.id, "Folder").unwrap();
        let summary = vault
            .list_notes()
            .unwrap()
            .into_iter()
            .find(|s| s.id == b.id)
            .unwrap();
        assert!(summary.path.replace('\\', "/").contains("Folder/"));

        vault.delete_note(&a.id).unwrap();
        assert!(vault.read_note(&a.id).is_err());
        assert_eq!(vault.list_notes().unwrap().len(), 1);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_notes_serves_from_index_without_rereading_disk() {
        let (vault, dir) = temp_vault();
        let note = vault.create_note("Cached").unwrap();

        // Corrupt the underlying file after the index was built. If
        // `list_notes` re-read from disk, this would break the listing.
        let path = dir.join("notes").join(format!("{}.json", slugify("Cached")));
        fs::write(&path, b"not json").unwrap();

        let listed = vault.list_notes().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, note.id);
        assert_eq!(listed[0].title, "Cached");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn move_note_preserves_id_and_updates_index() {
        let (vault, dir) = temp_vault();
        let note = vault.create_note("Movable").unwrap();
        vault.create_folder("Destination").unwrap();
        vault.move_note(&note.id, "Destination").unwrap();

        let reread = vault.read_note(&note.id).unwrap();
        assert_eq!(reread.id, note.id);

        let summary = vault
            .list_notes()
            .unwrap()
            .into_iter()
            .find(|s| s.id == note.id)
            .unwrap();
        assert!(summary.path.replace('\\', "/").contains("Destination/"));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn interrupted_write_leaves_no_tmp_and_preserves_prior_version() {
        let (vault, dir) = temp_vault();
        let note = vault.create_note("Fragile").unwrap();
        let path = dir.join("notes").join(format!("{}.json", slugify("Fragile")));
        assert!(path.exists());

        // Force the next write to fail (simulating a crash partway through) by
        // making the note's PARENT DIRECTORY read-only: the atomic-write temp
        // file can't be created in it, so the write errors before it can touch
        // the existing file. Marking the target *file* read-only wouldn't do it
        // — on POSIX a rename/replace only needs write permission on the parent
        // directory, so the replace would succeed and the file would change.
        let parent = path.parent().unwrap();
        let mut perms = fs::metadata(parent).unwrap().permissions();
        perms.set_readonly(true);
        fs::set_permissions(parent, perms).unwrap();

        let mut edited = note.clone();
        edited.title = "Should not persist".to_string();
        let result = vault.save_note(edited);

        let mut perms = fs::metadata(parent).unwrap().permissions();
        perms.set_readonly(false);
        fs::set_permissions(parent, perms).unwrap();

        assert!(
            result.is_err(),
            "expected the write to fail when the notes directory is read-only"
        );

        for entry in std::fs::read_dir(dir.join("notes")).unwrap() {
            let p = entry.unwrap().path();
            assert_ne!(p.extension().and_then(|e| e.to_str()), Some("tmp"));
        }

        let reread = vault.read_note(&note.id).unwrap();
        assert_eq!(reread.title, "Fragile");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn self_write_registry_records_each_write() {
        let (vault, dir) = temp_vault();
        let note = vault.create_note("Tracked").unwrap();
        let path = dir.join("notes").join(format!("{}.json", slugify("Tracked")));

        assert!(vault.peek_self_write(&path).is_some());
        assert!(vault.consume_self_write(&path).is_some());
        assert!(vault.peek_self_write(&path).is_none());

        let mut edited = note.clone();
        edited.title = "Tracked v2".to_string();
        vault.save_note(edited).unwrap();
        assert!(vault.peek_self_write(&path).is_some());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn folder_create_rename_move_delete() {
        let (vault, dir) = temp_vault();
        vault.create_folder("Biology").unwrap();
        assert!(dir.join("notes/Biology").is_dir());

        let note = vault.create_note("Cell").unwrap();
        vault.move_note(&note.id, "Biology").unwrap();

        vault.rename_folder("Biology", "Life Sciences").unwrap();
        assert!(dir.join("notes/Life Sciences").is_dir());
        assert!(!dir.join("notes/Biology").exists());
        assert_eq!(vault.read_note(&note.id).unwrap().id, note.id);
        let summary_path = vault
            .list_notes()
            .unwrap()
            .into_iter()
            .find(|s| s.id == note.id)
            .unwrap()
            .path;
        assert!(summary_path.replace('\\', "/").contains("Life Sciences/"));

        vault.create_folder("Science").unwrap();
        vault.move_folder("Life Sciences", "Science").unwrap();
        assert!(dir.join("notes/Science/Life Sciences").is_dir());
        assert_eq!(vault.read_note(&note.id).unwrap().id, note.id);

        vault.delete_folder("Science").unwrap();
        assert!(!dir.join("notes/Science").exists());
        assert!(vault.read_note(&note.id).is_err());
        assert_eq!(vault.list_notes().unwrap().len(), 0);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_tree_reflects_folders_and_notes_from_index() {
        let (vault, dir) = temp_vault();
        vault.create_folder("Biology").unwrap();
        vault.create_folder("Biology/Plants").unwrap(); // nested, empty
        let n1 = vault.create_note("Root Note").unwrap();
        let n2 = vault.create_note("Cell").unwrap();
        vault.move_note(&n2.id, "Biology").unwrap();

        let tree = vault.list_tree();

        let biology_children = tree
            .iter()
            .find_map(|n| match n {
                TreeNode::Folder(f) if f.name == "Biology" => Some(&f.children),
                _ => None,
            })
            .expect("Biology folder present");

        assert!(biology_children
            .iter()
            .any(|n| matches!(n, TreeNode::Folder(f) if f.name == "Plants")));
        assert!(biology_children
            .iter()
            .any(|n| matches!(n, TreeNode::Note(s) if s.id == n2.id)));
        assert!(tree
            .iter()
            .any(|n| matches!(n, TreeNode::Note(s) if s.id == n1.id)));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn note_summary_includes_icon() {
        let (vault, dir) = temp_vault();
        let mut note = vault.create_note("Iconic").unwrap();
        note.icon = Some(Icon::Emoji("1f331".to_string()));
        vault.save_note(note.clone()).unwrap();

        let summary = vault
            .list_notes()
            .unwrap()
            .into_iter()
            .find(|s| s.id == note.id)
            .unwrap();
        match summary.icon {
            Some(Icon::Emoji(ref cp)) => assert_eq!(cp, "1f331"),
            other => panic!("expected emoji icon, got {other:?}"),
        }

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn create_note_in_writes_directly_to_the_target_folder() {
        let (vault, dir) = temp_vault();
        vault.create_folder("Biology").unwrap();
        let note = vault.create_note_in("Cell", "Biology").unwrap();

        let summary = vault
            .list_notes()
            .unwrap()
            .into_iter()
            .find(|s| s.id == note.id)
            .unwrap();
        assert!(summary.path.replace('\\', "/").contains("Biology/"));
        assert!(dir.join("notes/Biology/cell.json").exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_icon_copies_into_attachments_icons_and_handles_collisions() {
        let (vault, dir) = temp_vault();

        let src_dir = std::env::temp_dir().join(format!("tundra-icon-src-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&src_dir).unwrap();
        let src = src_dir.join("sprout.png");
        fs::write(&src, b"not a real png, just bytes").unwrap();

        let rel = vault.import_icon(&src).unwrap();
        assert_eq!(rel.replace('\\', "/"), "attachments/icons/sprout.png");
        assert!(dir.join(&rel).exists());
        assert_eq!(fs::read(dir.join(&rel)).unwrap(), b"not a real png, just bytes");

        // Importing the same file name again doesn't clobber the first copy.
        let rel2 = vault.import_icon(&src).unwrap();
        assert_eq!(rel2.replace('\\', "/"), "attachments/icons/sprout-2.png");
        assert!(dir.join(&rel).exists());
        assert!(dir.join(&rel2).exists());

        std::fs::remove_dir_all(&src_dir).ok();
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_attachment_is_content_addressed_sharded_and_dedupes() {
        let (vault, dir) = temp_vault();

        let png = b"\x89PNG fake image bytes";
        let rel = vault.import_attachment(AttachmentKind::Image, "photo.png", png).unwrap();

        // Sharded under attachments/images/<first 2 hex of hash>/<hash>.png.
        let hex = blake3::hash(png).to_hex();
        let expected = format!("attachments/images/{}/{}.png", &hex[..2], hex);
        assert_eq!(rel.replace('\\', "/"), expected);

        // The returned path round-trips to a real file holding exactly the bytes.
        assert_eq!(fs::read(dir.join(&rel)).unwrap(), png);

        // Same content (even via a different original filename) dedupes to the
        // very same path, and does not create a second file in the shard dir.
        let rel2 = vault
            .import_attachment(AttachmentKind::Image, "renamed.png", png)
            .unwrap();
        assert_eq!(rel2, rel);
        let shard_dir = dir.join(format!("attachments/images/{}", &hex[..2]));
        let count = fs::read_dir(&shard_dir).unwrap().count();
        assert_eq!(count, 1, "identical content must not create a second file");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_attachment_distinct_content_gets_distinct_paths_and_kinds() {
        let (vault, dir) = temp_vault();

        let a = vault.import_attachment(AttachmentKind::Image, "a.png", b"aaaa").unwrap();
        let b = vault.import_attachment(AttachmentKind::Image, "b.png", b"bbbb").unwrap();
        assert_ne!(a, b, "different bytes must hash to different paths");

        // Kind selects the library subdirectory.
        let vid = vault.import_attachment(AttachmentKind::Video, "clip.mp4", b"movie").unwrap();
        let file = vault.import_attachment(AttachmentKind::File, "doc.pdf", b"%PDF").unwrap();
        assert!(vid.replace('\\', "/").starts_with("attachments/videos/"));
        assert!(file.replace('\\', "/").starts_with("attachments/files/"));
        assert!(dir.join(&vid).exists());
        assert!(dir.join(&file).exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_attachment_handles_a_missing_extension() {
        let (vault, dir) = temp_vault();
        let rel = vault.import_attachment(AttachmentKind::File, "READ ME", b"data").unwrap();
        let hex = blake3::hash(b"data").to_hex();
        assert_eq!(
            rel.replace('\\', "/"),
            format!("attachments/files/{}/{}", &hex[..2], hex)
        );
        assert!(dir.join(&rel).exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn creating_an_unrelated_folder_does_not_move_existing_root_notes() {
        let (vault, dir) = temp_vault();
        let a = vault.create_note("Alpha").unwrap();
        let b = vault.create_note("Beta").unwrap();
        let c = vault.create_note("Gamma").unwrap();

        vault.create_folder("Brand New Folder").unwrap();

        let notes = vault.list_notes().unwrap();
        for (id, title) in [(&a.id, "Alpha"), (&b.id, "Beta"), (&c.id, "Gamma")] {
            let summary = notes.iter().find(|s| &s.id == id).unwrap_or_else(|| panic!("{title} missing after folder create"));
            assert_eq!(
                summary.path.replace('\\', "/"),
                format!("notes/{}.json", title.to_lowercase()),
                "{title} should still be at the root, not moved into the new folder"
            );
        }

        let tree = vault.list_tree();
        let new_folder = tree
            .iter()
            .find_map(|n| match n {
                TreeNode::Folder(f) if f.name == "Brand New Folder" => Some(f),
                _ => None,
            })
            .expect("new folder present in tree");
        assert!(
            new_folder.children.is_empty(),
            "new folder should be empty, but contains: {:?}",
            new_folder.children
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_note_migrates_a_v1_string_content_file_on_disk() {
        // A Phase 0 note file written straight to disk (schemaVersion 1, with a
        // paragraph whose `content` is a raw string). Reading it must upgrade it
        // to the current shape with the text preserved — not discarded.
        // `temp_vault` lays down the `notes/` dir; we then drop a legacy file in
        // it and re-open so the index picks the hand-written note up.
        let (_seed, dir) = temp_vault();
        let path = dir.join("notes/legacy.json");
        let legacy = serde_json::json!({
            "schemaVersion": 1,
            "id": "11111111-1111-1111-1111-111111111111",
            "title": "Legacy",
            "created": "2026-07-01T10:00:00Z",
            "modified": "2026-07-01T10:00:00Z",
            "meta": { "pinned": false, "tags": [] },
            "blocks": [
                { "id": "b1", "type": "paragraph", "content": "hello\n# world" }
            ]
        });
        fs::write(&path, serde_json::to_vec_pretty(&legacy).unwrap()).unwrap();

        // Rebuild the index so the vault knows about the hand-written file.
        let vault = Vault::open(&dir).unwrap();
        let note = vault.read_note("11111111-1111-1111-1111-111111111111").unwrap();

        assert_eq!(note.schema_version, SCHEMA_VERSION);
        assert_eq!(
            note.blocks[0].content.as_ref().unwrap(),
            &serde_json::json!([{ "type": "text", "text": "hello\n# world", "styles": {} }]),
            "the legacy string text must be preserved as an inline text node"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn config_round_trips_and_rejects_traversal() {
        let (vault, dir) = temp_vault();

        // Missing config reads as None (not an error).
        assert!(vault.read_config("graph-view.json").unwrap().is_none());

        // Write then read back the exact contents, landing under .vault/config/.
        vault
            .write_config("graph-view.json", r#"{"ratio":1.5}"#)
            .unwrap();
        assert_eq!(
            vault.read_config("graph-view.json").unwrap().as_deref(),
            Some(r#"{"ratio":1.5}"#)
        );
        assert!(dir.join(".vault/config/graph-view.json").is_file());

        // Overwrite is atomic and replaces cleanly.
        vault.write_config("graph-view.json", "{}").unwrap();
        assert_eq!(vault.read_config("graph-view.json").unwrap().as_deref(), Some("{}"));

        // A name that tries to escape the config dir is rejected, on read AND write.
        for bad in ["../secret", "a/b", "..", "", ".\\evil"] {
            assert!(vault.read_config(bad).is_err(), "read must reject {bad:?}");
            assert!(vault.write_config(bad, "x").is_err(), "write must reject {bad:?}");
        }

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reconcile_path_picks_up_an_external_modify() {
        let (vault, dir) = temp_vault();
        let note = vault.create_note("Fern").unwrap();
        let path = dir.join("notes/fern.json");

        // Simulate an external editor changing the title on disk directly
        // (bypassing the vault entirely, so this is NOT a self-write).
        let mut on_disk: Note = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        on_disk.title = "Fern (edited externally)".to_string();
        fs::write(&path, serde_json::to_vec_pretty(&on_disk).unwrap()).unwrap();

        let events = vault.reconcile_path(&path);
        assert!(events.contains(&ChangeEvent::TreeChanged));
        assert!(events.contains(&ChangeEvent::NoteChangedExternally { id: note.id.clone() }));

        let summary = vault.list_notes().unwrap().into_iter().find(|s| s.id == note.id).unwrap();
        assert_eq!(summary.title, "Fern (edited externally)");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reconcile_path_picks_up_an_external_delete() {
        let (vault, dir) = temp_vault();
        let note = vault.create_note("Moss").unwrap();
        let path = dir.join("notes/moss.json");

        fs::remove_file(&path).unwrap(); // external delete, not through the vault

        let events = vault.reconcile_path(&path);
        assert!(events.contains(&ChangeEvent::TreeChanged));
        assert!(events.contains(&ChangeEvent::NoteChangedExternally { id: note.id.clone() }));
        assert!(vault.read_note(&note.id).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reconcile_path_ignores_non_json_artifacts() {
        let (vault, dir) = temp_vault();
        let stray = dir.join("notes/leftover.tmp");
        fs::write(&stray, b"partial write").unwrap();

        assert_eq!(vault.reconcile_path(&stray), Vec::new());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reconcile_path_tracks_externally_created_and_removed_folders() {
        let (vault, dir) = temp_vault();
        let folder_path = dir.join("notes/External Folder");
        fs::create_dir_all(&folder_path).unwrap(); // external mkdir, not through the vault

        let events = vault.reconcile_path(&folder_path);
        assert_eq!(events, vec![ChangeEvent::TreeChanged]);
        let tree = vault.list_tree();
        assert!(tree
            .iter()
            .any(|n| matches!(n, TreeNode::Folder(f) if f.name == "External Folder")));

        fs::remove_dir_all(&folder_path).unwrap(); // external rmdir
        let events = vault.reconcile_path(&folder_path);
        assert_eq!(events, vec![ChangeEvent::TreeChanged]);
        let tree = vault.list_tree();
        assert!(!tree
            .iter()
            .any(|n| matches!(n, TreeNode::Folder(f) if f.name == "External Folder")));

        std::fs::remove_dir_all(&dir).ok();
    }
}
