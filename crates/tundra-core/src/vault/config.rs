use super::*;

impl Vault {
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
}
