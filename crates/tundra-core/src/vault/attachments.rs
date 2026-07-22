use std::collections::HashSet;

use walkdir::WalkDir;

use crate::document::{Banner, Block, Note};

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

    /// Every media attachment path (`attachments/{images,videos,files}/…`)
    /// referenced by any `Note`-shaped document in the vault: block `props.url`
    /// values and image banners, gathered from every note, every template, and
    /// the quick-note scratchpad — plus every image saved in the banner gallery
    /// (`.vault/config/banners.json`), which is kept even when no note currently
    /// uses it as a cover. This is the *complete* set of things that keep a media
    /// file alive (CLAUDE.md §5.3). Custom **icons** are deliberately not
    /// tracked here: they live in the separate `attachments/icons/` library and
    /// are also referenced by frontend-owned folder config, so the orphan sweep
    /// never touches them.
    ///
    /// A document that fails to read is skipped rather than fatal — mirrors
    /// `empty_note_ids`/`list_templates`, so a single unreadable file can never
    /// make cleanup delete a still-referenced attachment.
    fn collect_referenced_media(&self) -> Result<HashSet<String>> {
        let mut referenced = HashSet::new();

        // Every indexed note (lock released before any disk read).
        let note_paths: Vec<PathBuf> = {
            let index = self.index.read().unwrap();
            index.notes.values().map(|e| e.path.clone()).collect()
        };
        for path in note_paths {
            if let Ok(note) = read_note_at(&path) {
                collect_note_media(&note, &mut referenced);
            }
        }

        // Templates (kept outside the note index).
        if let Ok(templates) = self.list_templates() {
            for t in templates {
                if let Ok(note) = self.read_template(&t.id) {
                    collect_note_media(&note, &mut referenced);
                }
            }
        }

        // The quick-note scratchpad (its own file at the vault root).
        if let Ok(note) = self.read_quick_note() {
            collect_note_media(&note, &mut referenced);
        }

        // The banner gallery (frontend-owned `.vault/config/banners.json`): a
        // list of vault-relative image paths the user has kept as reusable
        // covers. These are deliberately preserved even when no note currently
        // uses one as its banner — removing a cover from a note must not delete
        // the image, so the picker can still offer it.
        if let Ok(Some(raw)) = self.read_config("banners.json") {
            if let Ok(paths) = serde_json::from_str::<Vec<String>>(&raw) {
                referenced.extend(paths);
            }
        }

        Ok(referenced)
    }

    /// Delete every file in the media libraries (`attachments/{images,videos,
    /// files}`) that no note, template, or quick note references — the orphans
    /// left behind when an embed/banner is removed, a note is deleted, or a
    /// folder is deleted (nothing else in the app removes attachment bytes).
    /// Content-addressed dedup is honoured for free: a hash shared by several
    /// documents is in the referenced set as long as *any* of them survives, so
    /// it's kept. Never touches `attachments/icons`. Returns what it freed.
    pub fn cleanup_orphan_attachments(&self) -> Result<CleanupReport> {
        let referenced = self.collect_referenced_media()?;
        let mut removed = 0u32;
        let mut bytes = 0u64;

        for kind in ["images", "videos", "files"] {
            let dir = self.root.join("attachments").join(kind);
            if !dir.is_dir() {
                continue;
            }
            for entry in WalkDir::new(&dir).into_iter().filter_map(|e| e.ok()) {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                if referenced.contains(&self.rel_to_root(path)) {
                    continue;
                }
                let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
                if fs::remove_file(path).is_ok() {
                    removed += 1;
                    bytes += size;
                }
            }

            // Drop the `<aa>/` shard subdirectories emptied by the removals above
            // (and any that were already empty). `remove_dir` only succeeds on an
            // empty directory, so a shard still holding a live file is left alone,
            // and the library root itself (recreated on `Vault::open`) is kept.
            if let Ok(entries) = fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let shard = entry.path();
                    if shard.is_dir() {
                        let _ = fs::remove_dir(&shard);
                    }
                }
            }
        }

        Ok(CleanupReport {
            removed,
            bytes: bytes as f64,
        })
    }
}

/// Add every media attachment path referenced by one note — its image banner and
/// every block's `props.url` under `attachments/` — to `out`.
fn collect_note_media(note: &Note, out: &mut HashSet<String>) {
    if let Some(Banner::Image(path)) = &note.meta.banner {
        out.insert(path.clone());
    }
    for block in &note.blocks {
        collect_block_media(block, out);
    }
}

/// Recurse a block and its children, collecting any `props.url` that points into
/// the vault's attachment libraries.
fn collect_block_media(block: &Block, out: &mut HashSet<String>) {
    if let Some(url) = block
        .props
        .as_ref()
        .and_then(|p| p.get("url"))
        .and_then(|v| v.as_str())
    {
        if url.starts_with("attachments/") {
            out.insert(url.to_string());
        }
    }
    for child in &block.children {
        collect_block_media(child, out);
    }
}
