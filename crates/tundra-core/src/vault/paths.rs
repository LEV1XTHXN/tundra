use super::*;

pub(super) fn is_root(rel: &str) -> bool {
    rel.split('/').all(|c| c.is_empty())
}

/// Reject a vault-relative folder path that would resolve outside `notes/`.
///
/// Every folder path arriving from the frontend is user-controlled — the "new
/// folder" dialog concatenates a typed name onto its parent, and grouped-folder
/// paths are persisted in `.vault/config`, so they also come back from a file
/// that a shared vault could carry. Without this guard `abs_folder_path` pushes
/// `..` components verbatim, and since `delete_folder` ends in
/// `fs::remove_dir_all` that turns a typed name into "recursively delete a
/// directory outside the vault".
pub(super) fn validate_rel(rel: &str) -> Result<()> {
    if Path::new(rel).is_absolute() || rel.contains('\\') {
        return Err(CoreError::Vault(format!(
            "invalid folder path \"{rel}\": must be relative to the vault"
        )));
    }
    for comp in rel.split('/').filter(|c| !c.is_empty()) {
        if comp == ".." || comp == "." {
            return Err(CoreError::Vault(format!(
                "invalid folder path \"{rel}\": \"{comp}\" is not allowed"
            )));
        }
    }
    Ok(())
}

/// Reject a single folder *name* (a rename's new leaf). `rename_folder` joins
/// this onto the parent directly rather than going through `abs_folder_path`,
/// so it needs its own guard — and unlike a path, a name may not contain
/// separators at all.
pub(super) fn validate_name(name: &str) -> Result<()> {
    if name.is_empty() || name.contains('/') || name.contains('\\') {
        return Err(CoreError::Vault(format!(
            "invalid folder name \"{name}\": must not be empty or contain a path separator"
        )));
    }
    if name == ".." || name == "." {
        return Err(CoreError::Vault(format!(
            "invalid folder name \"{name}\""
        )));
    }
    Ok(())
}

/// Lowercase, spaces→dashes, keep alphanumerics/dash/underscore. Filenames are
/// convenience only; the UUID in the file is the real identity.
pub(super) fn slugify(title: &str) -> String {
    let mut slug: String = title
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else if c.is_whitespace() {
                '-'
            } else {
                '-'
            }
        })
        .collect();
    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "untitled".to_string()
    } else {
        slug
    }
}

/// First path of the form `{dir}/{base}.json`, `{dir}/{base}-2.json`, ... that
/// doesn't already exist.
pub(super) fn first_available(dir: &Path, base: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{base}.json"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{base}-{n}.json"));
        n += 1;
    }
    candidate
}

/// Like `first_available`, but for an arbitrary (optional) extension instead
/// of always `.json` — used for imported icon files.
pub(super) fn first_available_with_ext(dir: &Path, stem: &str, ext: Option<&str>) -> PathBuf {
    let suffix = ext.map(|e| format!(".{e}")).unwrap_or_default();
    let mut candidate = dir.join(format!("{stem}{suffix}"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}-{n}{suffix}"));
        n += 1;
    }
    candidate
}

/// Best-effort fsync of a directory so a preceding rename/replace is durable
/// across a crash, not merely atomic. Unix supports opening a directory for
/// this; Windows has no portable equivalent via `std`, so this is a no-op
/// there — the replace operation itself (`ReplaceFile`) is still atomic.
#[cfg(unix)]
pub(super) fn sync_dir(dir: &Path) {
    if let Ok(d) = fs::File::open(dir) {
        let _ = d.sync_all();
    }
}

#[cfg(not(unix))]
pub(super) fn sync_dir(_dir: &Path) {}
