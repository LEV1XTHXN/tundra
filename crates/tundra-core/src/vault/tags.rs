use super::*;

/// Trim, drop empties, and de-duplicate a tag set (first occurrence wins,
/// original order preserved) so the note's on-disk tag list is always clean.
fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    tags.into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty() && seen.insert(t.clone()))
        .collect()
}

impl Vault {
    /// Replace a note's tag set wholesale and persist (which mirrors the new tags
    /// into the index via `save_note`). Tags are trimmed, de-duplicated, and
    /// empties dropped so the on-disk set stays clean regardless of caller input.
    pub fn set_note_tags(&self, id: &str, tags: Vec<String>) -> Result<()> {
        let mut note = self.read_note(id)?;
        let cleaned = normalize_tags(tags);
        if note.meta.tags != cleaned {
            note.meta.tags = cleaned;
            self.save_note(note)?;
        }
        Ok(())
    }

    /// Add a single tag to a note (deduped, trimmed). A blank or already-present
    /// tag is a no-op — no rewrite, no mtime bump.
    pub fn add_note_tag(&self, id: &str, tag: &str) -> Result<()> {
        let tag = tag.trim();
        if tag.is_empty() {
            return Ok(());
        }
        let mut note = self.read_note(id)?;
        if !note.meta.tags.iter().any(|t| t == tag) {
            note.meta.tags.push(tag.to_string());
            self.save_note(note)?;
        }
        Ok(())
    }

    /// Add a single tag to a note at the **front** of its tag list (deduped,
    /// trimmed). Used for the Kanban column tag so the board's tag always sorts
    /// before a note's other tags. If the tag is already present it's moved to the
    /// front; a blank tag is a no-op.
    pub fn prepend_note_tag(&self, id: &str, tag: &str) -> Result<()> {
        let tag = tag.trim();
        if tag.is_empty() {
            return Ok(());
        }
        let mut note = self.read_note(id)?;
        if note.meta.tags.first().map(|t| t.as_str()) == Some(tag) {
            return Ok(());
        }
        note.meta.tags.retain(|t| t != tag);
        note.meta.tags.insert(0, tag.to_string());
        self.save_note(note)?;
        Ok(())
    }

    /// Remove a single tag from a note (exact match) and persist if it changed.
    pub fn remove_note_tag(&self, id: &str, tag: &str) -> Result<()> {
        let mut note = self.read_note(id)?;
        let before = note.meta.tags.len();
        note.meta.tags.retain(|t| t != tag);
        if note.meta.tags.len() != before {
            self.save_note(note)?;
        }
        Ok(())
    }

    /// Rename a tag across the **whole vault**: every note carrying `from` has it
    /// replaced by `to` (trimmed), in place, preserving order. A note that already
    /// carries `to` collapses the resulting duplicate. Returns the ids of the notes
    /// actually rewritten, so the caller can reindex just those. A blank `to`, or
    /// `from == to`, is a no-op.
    ///
    /// Candidates come from the in-memory summary index (which mirrors each note's
    /// tags), so only notes that actually carry the tag are read from disk.
    pub fn rename_tag(&self, from: &str, to: &str) -> Result<Vec<String>> {
        let to = to.trim();
        if to.is_empty() || from == to {
            return Ok(Vec::new());
        }
        let candidates: Vec<String> = {
            let index = self.index.read().unwrap();
            index
                .notes
                .iter()
                .filter(|(_, e)| e.summary.tags.iter().any(|t| t == from))
                .map(|(id, _)| id.clone())
                .collect()
        };
        let mut changed = Vec::new();
        for id in candidates {
            let mut note = self.read_note(&id)?;
            if !note.meta.tags.iter().any(|t| t == from) {
                continue; // summary was stale; nothing to do
            }
            let renamed: Vec<String> = note
                .meta
                .tags
                .iter()
                .map(|t| if t == from { to.to_string() } else { t.clone() })
                .collect();
            let deduped = normalize_tags(renamed);
            if note.meta.tags != deduped {
                note.meta.tags = deduped;
                self.save_note(note)?;
                changed.push(id);
            }
        }
        Ok(changed)
    }

    /// Every distinct tag in use anywhere in the vault, sorted. Derived from the
    /// in-memory summary index (no disk reads) — the pool for tag suggestions and
    /// the settings tag manager.
    pub fn list_tags(&self) -> Vec<String> {
        let index = self.index.read().unwrap();
        let mut set = std::collections::BTreeSet::new();
        for entry in index.notes.values() {
            for tag in &entry.summary.tags {
                set.insert(tag.clone());
            }
        }
        set.into_iter().collect()
    }

    /// Delete a tag from the **whole vault**: drop it from every note that carries
    /// it. Unlike `remove_note_tag` (one note), this makes the tag cease to exist
    /// across the vault. Returns the ids of the notes actually rewritten, so the
    /// caller can reindex just those. Candidates come from the summary index, so
    /// only notes that carry the tag are touched.
    pub fn delete_tag(&self, tag: &str) -> Result<Vec<String>> {
        let candidates: Vec<String> = {
            let index = self.index.read().unwrap();
            index
                .notes
                .iter()
                .filter(|(_, e)| e.summary.tags.iter().any(|t| t == tag))
                .map(|(id, _)| id.clone())
                .collect()
        };
        let mut changed = Vec::new();
        for id in candidates {
            let mut note = self.read_note(&id)?;
            let before = note.meta.tags.len();
            note.meta.tags.retain(|t| t != tag);
            if note.meta.tags.len() != before {
                self.save_note(note)?;
                changed.push(id);
            }
        }
        Ok(changed)
    }
}
