use super::*;

impl Vault {
    fn templates_dir(&self) -> PathBuf {
        self.root.join("templates")
    }

    /// The on-disk path of the template with `id`, found by scanning
    /// `templates/`. Errors with `NotFound` if no template file carries that id.
    fn template_path(&self, id: &str) -> Result<PathBuf> {
        let dir = self.templates_dir();
        if dir.is_dir() {
            for entry in fs::read_dir(&dir)?.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }
                // Skip unreadable/corrupt template files rather than failing.
                if let Ok(note) = read_note_at(&path) {
                    if note.id == id {
                        return Ok(path);
                    }
                }
            }
        }
        Err(CoreError::NotFound(id.to_string()))
    }

    /// Every template's shallow summary (id/title/icon), title-sorted. Corrupt or
    /// unreadable template files are skipped, never fatal.
    pub fn list_templates(&self) -> Result<Vec<TemplateSummary>> {
        let dir = self.templates_dir();
        let mut out = Vec::new();
        if dir.is_dir() {
            for entry in fs::read_dir(&dir)?.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }
                if let Ok(note) = read_note_at(&path) {
                    out.push(TemplateSummary {
                        id: note.id,
                        title: note.title,
                        icon: note.icon,
                    });
                }
            }
        }
        out.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
        Ok(out)
    }

    /// Create a new, empty template and persist it under `templates/`.
    pub fn create_template(&self, title: &str) -> Result<Note> {
        let title = if title.trim().is_empty() {
            "Untitled template"
        } else {
            title.trim()
        };
        let dir = self.templates_dir();
        fs::create_dir_all(&dir)?;
        let note = Note::new(title);
        let path = first_available(&dir, &slugify(&note.title));
        self.write_note_at(&path, &note)?;
        Ok(note)
    }

    /// Read a template's full document by id.
    pub fn read_template(&self, id: &str) -> Result<Note> {
        read_note_at(&self.template_path(id)?)
    }

    /// Persist an edited template (atomic, validated like any note). Bumps
    /// `modified`. If the id isn't found on disk (e.g. first save of a template
    /// created in-memory) it's written to a fresh, collision-free path — the same
    /// fallback `save_note` uses for a note missing from the index.
    pub fn save_template(&self, mut note: Note) -> Result<()> {
        note.validate()?;
        note.modified = chrono::Utc::now();
        let path = match self.template_path(&note.id) {
            Ok(p) => p,
            Err(_) => {
                let dir = self.templates_dir();
                fs::create_dir_all(&dir)?;
                first_available(&dir, &slugify(&note.title))
            }
        };
        self.write_note_at(&path, &note)?;
        Ok(())
    }

    /// Delete a template by id (removes the file and any rolling `.bak`).
    pub fn delete_template(&self, id: &str) -> Result<()> {
        let path = self.template_path(id)?;
        fs::remove_file(&path)?;
        let _ = fs::remove_file(path.with_extension("json.bak"));
        Ok(())
    }
}
