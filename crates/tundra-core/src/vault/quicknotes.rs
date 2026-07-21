use super::*;

impl Vault {
    fn quick_note_path(&self) -> PathBuf {
        self.root.join("quicknote.json")
    }

    /// Read the quick note, or a fresh empty one if it's never been written yet
    /// (not persisted until the user actually saves something).
    pub fn read_quick_note(&self) -> Result<Note> {
        let path = self.quick_note_path();
        if path.is_file() {
            read_note_at(&path)
        } else {
            Ok(Note::new("Quick notes"))
        }
    }

    /// Persist the quick note (atomic, same temp+rename discipline as any note).
    /// Not added to the note index — it isn't part of the notes tree.
    pub fn save_quick_note(&self, mut note: Note) -> Result<()> {
        note.validate()?;
        note.modified = chrono::Utc::now();
        self.write_note_at(&self.quick_note_path(), &note)
    }

    // --- templates -------------------------------------------------------
    //
    // A template is a reusable, `Note`-shaped document the user inserts into a
    // blank note. Templates live in their own `templates/` directory at the vault
    // root — OUTSIDE `notes/` — so, exactly like the quick note, they never enter
    // the note index, tree, search, links, or graph. They reuse the `Note` block
    // model (and thus the same atomic-write + validation machinery) but are a
    // separate, small collection kept off the note index entirely.
    //
    // The collection is small (a handful of templates), so — unlike notes — there
    // is no in-memory id→path index: template ops walk `templates/` directly. That
    // keeps `Vault::open` untouched and the note index uncontaminated, at the cost
    // of an O(n) directory scan on operations the user triggers by hand (never a
    // hot path).
}
