use super::*;

/// Single pass over `notes/` building the id -> {path, summary} index and the
/// set of known folders (including empty ones). This is the one place a fresh
/// `Vault::open` pays an O(N) cost; everything afterward is served from here.
pub(super) fn build_index(root: &Path) -> Result<VaultIndex> {
    let notes_dir = root.join("notes");
    let mut idx = VaultIndex::default();

    for entry in WalkDir::new(&notes_dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path == notes_dir {
            continue;
        }
        if entry.file_type().is_dir() {
            if let Ok(rel) = path.strip_prefix(&notes_dir) {
                idx.folders.insert(rel.to_path_buf());
            }
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        // Skip unreadable/corrupt files rather than failing the whole open.
        let Ok(note) = read_note_at(path) else {
            continue;
        };
        let rel_to_root = path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .into_owned();
        let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        let summary = NoteSummary::from_note(&note, rel_to_root, size);
        idx.notes.insert(
            note.id.clone(),
            IndexEntry {
                path: path.to_path_buf(),
                summary,
            },
        );
    }
    Ok(idx)
}

pub(super) fn read_note_at(path: &Path) -> Result<Note> {
    let bytes = fs::read(path)?;
    let mut note: Note = serde_json::from_slice(&bytes)?;
    if note.schema_version > SCHEMA_VERSION {
        return Err(CoreError::SchemaTooNew {
            found: note.schema_version,
            supported: SCHEMA_VERSION,
        });
    }
    // Upgrade older on-disk notes to the current shape before anyone sees them
    // (lazy — persisted on the next save). This is the single choke point every
    // read passes through (direct reads and the `build_index` walk both land here).
    note.migrate();
    Ok(note)
}

fn get_or_create<'a>(root: &'a mut FolderAccum, rel: &Path) -> &'a mut FolderAccum {
    let mut node = root;
    for comp in rel.iter() {
        let name = comp.to_string_lossy().into_owned();
        node = node.subfolders.entry(name).or_default();
    }
    node
}

fn to_tree_nodes(node: FolderAccum, prefix: &str) -> Vec<TreeNode> {
    let mut out: Vec<TreeNode> = node
        .subfolders
        .into_iter()
        .map(|(name, child)| {
            let path = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            let children = to_tree_nodes(child, &path);
            TreeNode::Folder(FolderNode {
                name,
                path,
                children,
            })
        })
        .collect();

    let mut notes = node.notes;
    notes.sort_by(|a, b| a.title.cmp(&b.title));
    out.extend(notes.into_iter().map(TreeNode::Note));
    out
}

/// In-progress folder/note accumulator used only while building `list_tree`'s
/// output; not exposed outside this module.
#[derive(Default)]
struct FolderAccum {
    notes: Vec<NoteSummary>,
    subfolders: BTreeMap<String, FolderAccum>,
}

impl Vault {
    /// List all notes in the vault (shallow metadata only) — served entirely
    /// from the in-memory index, no disk reads.
    pub fn list_notes(&self) -> Result<Vec<NoteSummary>> {
        let index = self.index.read().unwrap();
        let mut out: Vec<NoteSummary> = index.notes.values().map(|e| e.summary.clone()).collect();
        out.sort_by(|a, b| b.modified.cmp(&a.modified));
        Ok(out)
    }

    /// The current summary for a single note, if it exists — served from the
    /// index like `list_notes`, no disk read. Used by the Tauri layer to get
    /// a note's current vault-relative path for search indexing.
    pub fn note_summary(&self, id: &str) -> Option<NoteSummary> {
        self.index.read().unwrap().notes.get(id).map(|e| e.summary.clone())
    }

    /// The folder/note tree, built from the in-memory index (no disk reads).
    pub fn list_tree(&self) -> Vec<TreeNode> {
        let index = self.index.read().unwrap();
        let mut root = FolderAccum::default();

        // Every known folder is a node, even ones with no notes in them yet.
        for folder in &index.folders {
            get_or_create(&mut root, folder);
        }
        for entry in index.notes.values() {
            let rel = self.rel_to_notes(&entry.path);
            let parent = rel.parent().unwrap_or_else(|| Path::new(""));
            get_or_create(&mut root, parent)
                .notes
                .push(entry.summary.clone());
        }

        to_tree_nodes(root, "")
    }

    /// After a folder rename/move on disk, rewrite every affected note path
    /// and folder-set entry from the old prefix to the new one.
    pub(super) fn reindex_subtree(&self, old_abs: &Path, new_abs: &Path) {
        let notes_dir = self.notes_dir();
        let mut index = self.index.write().unwrap();

        for entry in index.notes.values_mut() {
            if let Ok(suffix) = entry.path.strip_prefix(old_abs) {
                let new_path = new_abs.join(suffix);
                entry.summary.path = self.rel_to_root(&new_path);
                entry.path = new_path;
            }
        }

        let old_rel = old_abs.strip_prefix(&notes_dir).unwrap_or(old_abs);
        let new_rel = new_abs.strip_prefix(&notes_dir).unwrap_or(new_abs);
        let affected: Vec<PathBuf> = index
            .folders
            .iter()
            .filter(|f| f.as_path() == old_rel || f.starts_with(old_rel))
            .cloned()
            .collect();
        for f in affected {
            index.folders.remove(&f);
            if let Ok(suffix) = f.strip_prefix(old_rel) {
                index.folders.insert(new_rel.join(suffix));
            }
        }
    }
}
