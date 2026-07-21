use super::*;

impl Vault {
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

    pub(super) fn record_self_write(&self, path: &Path) -> Result<()> {
        let mtime = fs::metadata(path)?.modified()?;
        self.self_writes
            .write()
            .unwrap()
            .insert(path.to_path_buf(), mtime);
        Ok(())
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
                    let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
                    let summary = NoteSummary::from_note(&note, self.rel_to_root(path), size);
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
