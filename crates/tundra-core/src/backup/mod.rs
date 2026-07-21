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
mod tests;
