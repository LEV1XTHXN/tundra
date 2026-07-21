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
