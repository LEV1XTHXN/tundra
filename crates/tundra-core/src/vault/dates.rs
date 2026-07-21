use super::*;

impl Vault {
    /// Note→date links whose date falls in the inclusive `[start, end]` range,
    /// served entirely from the in-memory index (the mirrored
    /// `NoteSummary::dates`) — no note files are re-read. One entry per matching
    /// (note, date) pair.
    pub fn notes_in_date_range(&self, start: NaiveDate, end: NaiveDate) -> Vec<NoteDateEntry> {
        let index = self.index.read().unwrap();
        let mut out = Vec::new();
        for entry in index.notes.values() {
            for nd in &entry.summary.dates {
                if nd.date >= start && nd.date <= end {
                    out.push(NoteDateEntry {
                        note_id: entry.summary.id.clone(),
                        title: entry.summary.title.clone(),
                        icon: entry.summary.icon.clone(),
                        date: nd.date,
                        event_id: nd.event_id.clone(),
                    });
                }
            }
        }
        out
    }

    /// Add a note→date link and persist the note (which mirrors the new date into
    /// the index via `save_note`). Deduped: an identical link is a no-op.
    pub fn add_note_date(&self, id: &str, note_date: NoteDate) -> Result<()> {
        let mut note = self.read_note(id)?;
        if !note.meta.dates.contains(&note_date) {
            note.meta.dates.push(note_date);
            self.save_note(note)?;
        }
        Ok(())
    }

    /// Remove a note→date link (matched exactly) and persist.
    pub fn remove_note_date(&self, id: &str, note_date: &NoteDate) -> Result<()> {
        let mut note = self.read_note(id)?;
        let before = note.meta.dates.len();
        note.meta.dates.retain(|d| d != note_date);
        if note.meta.dates.len() != before {
            self.save_note(note)?;
        }
        Ok(())
    }

    // --- note properties (folder table view) -----------------------------
}
