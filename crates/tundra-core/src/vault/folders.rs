use super::*;

impl Vault {
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

    /// Resolve a `/`-separated folder path (relative to `notes/`) to an
    /// absolute path. `""` (or any all-slash string) means the notes root.
    pub(super) fn abs_folder_path(&self, rel: &str) -> PathBuf {
        let mut p = self.notes_dir();
        for comp in rel.split('/').filter(|c| !c.is_empty()) {
            p.push(comp);
        }
        p
    }
}
