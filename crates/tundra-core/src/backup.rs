//! One-click vault backup (Phase 3 step 3).
//!
//! Produces a single `.zip` of the entire vault, **excluding** the rebuildable
//! `.vault/cache/` (CLAUDE.md §5.2: cache is derived, never backed up as source),
//! written to a caller-provided directory that must live **outside** the vault
//! (CLAUDE.md §6.1 `backup`). The archive is verified readable before success is
//! reported — the vault is the user's life's work, so a torn/truncated backup
//! must never be mistaken for a good one.

use std::fs::File;
use std::path::{Path, PathBuf};

use chrono::Local;
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::error::{CoreError, Result};
use crate::vault::Vault;

/// The rebuildable cache subtree, excluded from every backup.
const EXCLUDE: &str = ".vault/cache";

/// Back up `vault` into `dest_dir`, returning the path of the written archive.
/// The filename is `<VaultName>-backup-YYYYMMDD-HHMMSS.zip` (local time).
pub fn backup_vault(vault: &Vault, dest_dir: &Path) -> Result<PathBuf> {
    let root = vault.root();
    // The archive must live OUTSIDE the vault it backs up — otherwise it would
    // (a) try to include itself and (b) bloat future backups.
    if dest_dir.starts_with(root) {
        return Err(CoreError::Vault(
            "backup destination must be outside the vault".into(),
        ));
    }
    std::fs::create_dir_all(dest_dir)?;

    let stamp = Local::now().format("%Y%m%d-%H%M%S");
    let archive_path = dest_dir.join(format!("{}-backup-{}.zip", vault.info().name, stamp));

    write_archive(root, &archive_path)?;
    verify_archive(&archive_path)?;
    Ok(archive_path)
}

fn write_archive(root: &Path, archive_path: &Path) -> Result<()> {
    let file = File::create(archive_path)?;
    let mut zip = ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let exclude = Path::new(EXCLUDE);

    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        let Ok(rel) = path.strip_prefix(root) else {
            continue;
        };
        if rel.as_os_str().is_empty() {
            continue; // the root directory itself
        }
        // `starts_with` is component-wise, so this matches `.vault/cache` and
        // everything under it on every platform, regardless of separator.
        if rel.starts_with(exclude) {
            continue;
        }

        // Zip entry names are forward-slash separated and vault-relative.
        let name = rel.to_string_lossy().replace('\\', "/");
        if entry.file_type().is_dir() {
            zip.add_directory(name, opts).map_err(zip_err)?;
        } else if entry.file_type().is_file() {
            zip.start_file(name, opts).map_err(zip_err)?;
            let mut f = File::open(path)?;
            std::io::copy(&mut f, &mut zip)?;
        }
    }
    zip.finish().map_err(zip_err)?;
    Ok(())
}

/// Reopen the finished archive and read its central directory + every entry's
/// header, so a corrupt/truncated write is caught before reporting success.
fn verify_archive(archive_path: &Path) -> Result<()> {
    let file = File::open(archive_path)?;
    let mut archive = ZipArchive::new(file).map_err(zip_err)?;
    for i in 0..archive.len() {
        archive.by_index(i).map_err(zip_err)?;
    }
    Ok(())
}

fn zip_err(e: zip::result::ZipError) -> CoreError {
    CoreError::Io(e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;
    use uuid::Uuid;

    #[test]
    fn backup_zips_vault_excluding_cache_and_verifies() {
        let dir = std::env::temp_dir().join(format!("tundra-bak-{}", Uuid::new_v4()));
        let vault = Vault::open(&dir).unwrap();
        vault.create_note("Photosynthesis").unwrap();
        // A content config file (must be included) …
        vault.write_config("calendar.json", "[]").unwrap();
        // … and a derived cache file (must be excluded).
        let cache_file = dir.join(".vault/cache/search/meta.json");
        std::fs::create_dir_all(cache_file.parent().unwrap()).unwrap();
        File::create(&cache_file).unwrap().write_all(b"derived").unwrap();

        // Destination OUTSIDE the vault.
        let dest = std::env::temp_dir().join(format!("tundra-bak-dest-{}", Uuid::new_v4()));
        let archive_path = backup_vault(&vault, &dest).unwrap();

        // Timestamped, well-formed name.
        let file_name = archive_path.file_name().unwrap().to_string_lossy().into_owned();
        assert!(file_name.ends_with(".zip"));
        let re = regex_lite(&file_name);
        assert!(re, "unexpected backup name: {file_name}");

        // Inspect the archive contents.
        let mut archive = ZipArchive::new(File::open(&archive_path).unwrap()).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        assert!(names.iter().any(|n| n.starts_with("notes/")), "notes/ included");
        assert!(names.iter().any(|n| n == ".vault/config/calendar.json"), "config included");
        assert!(!names.iter().any(|n| n.starts_with(".vault/cache")), "cache excluded");

        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&dest).ok();
    }

    #[test]
    fn backup_rejects_a_destination_inside_the_vault() {
        let dir = std::env::temp_dir().join(format!("tundra-bak-{}", Uuid::new_v4()));
        let vault = Vault::open(&dir).unwrap();
        let inside = dir.join("backups");
        assert!(backup_vault(&vault, &inside).is_err(), "must refuse a dest inside the vault");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Minimal check that a name looks like `*-backup-YYYYMMDD-HHMMSS.zip`
    /// without pulling in a regex dependency.
    fn regex_lite(name: &str) -> bool {
        let Some(rest) = name.strip_suffix(".zip") else {
            return false;
        };
        let Some(idx) = rest.rfind("-backup-") else {
            return false;
        };
        let stamp = &rest[idx + "-backup-".len()..];
        let (date, time) = match stamp.split_once('-') {
            Some(parts) => parts,
            None => return false,
        };
        date.len() == 8 && date.chars().all(|c| c.is_ascii_digit())
            && time.len() == 6 && time.chars().all(|c| c.is_ascii_digit())
    }
}
