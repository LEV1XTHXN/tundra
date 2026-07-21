use super::*;

impl Vault {
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

    /// Import a user-chosen image from disk (e.g. the Pictures folder, via the
    /// native dialog in `services`) for use as a note **banner**, returning its
    /// vault-relative path under `attachments/images/`. Reads the file here so all
    /// FS access stays in the core, then delegates to the content-addressed
    /// `import_attachment` — so banner images dedupe and land in the same image
    /// library as editor embeds, rather than a banner-specific folder.
    pub fn import_banner(&self, src_path: &Path) -> Result<String> {
        let bytes = fs::read(src_path)?;
        let file_name = src_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "banner".to_string());
        self.import_attachment(AttachmentKind::Image, &file_name, &bytes)
    }

    /// Copy an attachment from an arbitrary path on disk — the vault-import
    /// pipeline's source folder, not a browser `File` — into the
    /// content-addressed library, by caller-chosen `kind`. Same "read here so
    /// FS access stays in the core" shape as `import_banner`, generalized past
    /// a hardcoded `Image` kind so the import pipeline can copy images, videos,
    /// and other files alike.
    pub fn import_attachment_from_path(&self, kind: AttachmentKind, src_path: &Path) -> Result<String> {
        let bytes = fs::read(src_path)?;
        let file_name = src_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "file".to_string());
        self.import_attachment(kind, &file_name, &bytes)
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
}
