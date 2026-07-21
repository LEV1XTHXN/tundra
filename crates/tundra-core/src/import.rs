//! Generic import-source filesystem primitives (CLAUDE.md §6.1-adjacent — this
//! module is the shared, source-agnostic half of the import pipeline; the
//! per-app rules — which files are notes vs. attachments, Markdown quirks like
//! Obsidian's `[[wikilinks]]` — live in the frontend adapter, e.g.
//! `src/import/obsidianAdapter.ts`. This module only ever reads an arbitrary
//! folder the user picked; it never opens it as a Tundra vault.
//!
//! **Locked rule: no Markdown parsing here.** BlockNote owns Markdown → block
//! conversion (CLAUDE.md's `markdown` module note); this module hands back raw
//! file listings and raw text, nothing more.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;
use walkdir::WalkDir;

use crate::error::Result;

/// One file found under a scanned source folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct SourceFile {
    /// Path relative to the scanned root, forward-slash separated (portable
    /// across platforms) — what an adapter classifies and later re-joins
    /// under the destination vault's `notes/` root to preserve nesting.
    pub rel_path: String,
}

/// Recursively list every regular file under `root`, skipping dotfiles/
/// dot-directories (`.obsidian`, `.git`, `.DS_Store`, …) — a generic "hidden
/// app/VCS metadata" exclusion that isn't specific to any one source app.
/// Sorted by path so callers (and tests) get a stable, deterministic order.
pub fn scan_folder(root: &Path) -> Result<Vec<SourceFile>> {
    let mut files = Vec::new();
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| e.path() == root || !is_dotfile(e.path()))
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let Ok(rel) = path.strip_prefix(root) else {
            continue;
        };
        let rel_path = rel.to_string_lossy().replace('\\', "/");
        files.push(SourceFile { rel_path });
    }
    files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    Ok(files)
}

fn is_dotfile(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with('.'))
}

/// Read a source file's text content. Falls back to a lossy UTF-8 decode on
/// invalid encoding rather than failing the whole import over one odd file —
/// graceful degradation applies to reading the source, not just conversion.
pub fn read_text_file(path: &Path) -> Result<String> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::InvalidData => {
            Ok(String::from_utf8_lossy(&fs::read(path)?).into_owned())
        }
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, content: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    #[test]
    fn scan_folder_lists_nested_files_and_skips_dotfiles() {
        let root = std::env::temp_dir().join(format!("tundra-import-scan-{}", uuid::Uuid::new_v4()));
        write(&root.join("Note.md"), "# Note");
        write(&root.join("Biology/Cell.md"), "# Cell");
        write(&root.join("Biology/Plants/Fern.md"), "# Fern");
        write(&root.join("attachments/photo.png"), "not really a png");
        // Obsidian's own config dir and a stray VCS dir — must be excluded.
        write(&root.join(".obsidian/config.json"), "{}");
        write(&root.join(".git/HEAD"), "ref: refs/heads/main");

        let files = scan_folder(&root).unwrap();
        let paths: Vec<&str> = files.iter().map(|f| f.rel_path.as_str()).collect();
        assert_eq!(
            paths,
            vec![
                "Biology/Cell.md",
                "Biology/Plants/Fern.md",
                "Note.md",
                "attachments/photo.png",
            ]
        );
        assert!(!paths.iter().any(|p| p.contains(".obsidian")));
        assert!(!paths.iter().any(|p| p.contains(".git")));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn read_text_file_reads_plain_utf8() {
        let root = std::env::temp_dir().join(format!("tundra-import-read-{}", uuid::Uuid::new_v4()));
        let file = root.join("Note.md");
        write(&file, "# Hello\n\nSome body text.");

        let text = read_text_file(&file).unwrap();
        assert_eq!(text, "# Hello\n\nSome body text.");

        fs::remove_dir_all(&root).ok();
    }
}
