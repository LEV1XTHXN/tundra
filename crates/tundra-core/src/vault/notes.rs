use super::*;

impl Vault {
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
        self.persist_new(Note::new(title), folder_rel)
    }

    /// Write a freshly-built note into `folder_rel` and index it — the shared
    /// tail of the create path, so the summary is populated the same way whether
    /// the note is created at the root or inside a folder.
    fn persist_new(&self, note: Note, folder_rel: &str) -> Result<Note> {
        let dir = self.abs_folder_path(folder_rel);
        fs::create_dir_all(&dir)?;
        let path = first_available(&dir, &slugify(&note.title));
        self.write_note_at(&path, &note)?;

        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let summary = NoteSummary::from_note(&note, self.rel_to_root(&path), size);
        self.index
            .write()
            .unwrap()
            .notes
            .insert(note.id.clone(), IndexEntry { path, summary });
        Ok(note)
    }

    // --- quick note (Phase 2 step 5) ------------------------------------
    //
    // The quick note is a SINGLE always-there scratchpad for fast idea capture,
    // NOT one of the vault's notes. It lives in its own file at the vault root
    // (outside `notes/`), so it never shows up in the nav tree, search, links, or
    // the graph — content lands here first and gets organized into real notes
    // later. It reuses the `Note` block model (so the same editor + atomic-write
    // machinery apply) but is deliberately kept out of the note index.

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

        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let summary = NoteSummary::from_note(&note, self.rel_to_root(&path), size);
        self.index
            .write()
            .unwrap()
            .notes
            .insert(note.id.clone(), IndexEntry { path, summary });
        Ok(())
    }

    // --- note→date links (Phase 3 step 1) --------------------------------

    /// Set (or clear, with `None`) one user-defined property value on a note and
    /// persist (which mirrors `meta.properties` into the index via `save_note`).
    /// The value is stored opaquely — the core does not interpret the property
    /// type system (folder-scoped definitions live in frontend config); it only
    /// carries the value so the table view can render/sort it. Writing the value
    /// already present, or clearing an absent key, is a no-op — no rewrite, no
    /// mtime churn.
    pub fn set_note_property(
        &self,
        id: &str,
        key: &str,
        value: Option<serde_json::Value>,
    ) -> Result<()> {
        let mut note = self.read_note(id)?;
        let changed = match value {
            Some(v) => {
                if note.meta.properties.get(key) == Some(&v) {
                    false
                } else {
                    note.meta.properties.insert(key.to_string(), v);
                    true
                }
            }
            None => note.meta.properties.remove(key).is_some(),
        };
        if changed {
            self.save_note(note)?;
        }
        Ok(())
    }

    // --- note tags (Phase 3+ / Kanban) -----------------------------------

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

    /// Ids of every note whose **body is empty** (see `Note::is_empty`) — the
    /// candidates for the settings "vault cleanup" action. Reads each note body
    /// (summaries don't carry blocks); a note that fails to read is skipped rather
    /// than reported, so cleanup never trips over a single unreadable file. The
    /// index lock is released before any file is read.
    pub fn empty_note_ids(&self) -> Result<Vec<String>> {
        let ids: Vec<String> = {
            let index = self.index.read().unwrap();
            index.notes.keys().cloned().collect()
        };
        let mut empty = Vec::new();
        for id in ids {
            if let Ok(note) = self.read_note(&id) {
                if note.is_empty() {
                    empty.push(id);
                }
            }
        }
        Ok(empty)
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

    /// Atomic write: temp file (same directory) -> fsync the temp file ->
    /// atomic replace over the target -> fsync the parent directory. Keeps a
    /// single rolling `.bak` of whatever was previously at `path`. Uses
    /// `tempfile`'s `persist`, which is `ReplaceFile` on Windows and `rename`
    /// on Unix, so an existing target is replaced safely either way. If any
    /// step fails, the temp file is cleaned up automatically (it's dropped
    /// on error) and the file at `path` — if it existed — is left untouched.
    pub(super) fn write_note_at(&self, path: &Path, note: &Note) -> Result<()> {
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

    /// Build a filesystem-safe, collision-free path from a title.
    fn unique_note_path(&self, title: &str) -> PathBuf {
        first_available(&self.notes_dir(), &slugify(title))
    }
}
