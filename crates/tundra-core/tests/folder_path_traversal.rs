//! Folder paths must never resolve outside the vault.
//!
//! Every folder path reaching these methods is user-controlled: the "new
//! folder" dialog concatenates a typed name onto its parent, and grouped-folder
//! paths round-trip through `.vault/config`, so they also arrive from a file a
//! shared vault could carry. `delete_folder` ends in `fs::remove_dir_all`, so a
//! missing check here means a typed name can recursively delete a directory
//! outside the vault.
use tundra_core::Vault;

/// A vault plus a sibling directory that nothing inside the vault may touch.
fn fixture() -> (Vault, std::path::PathBuf) {
    let base = std::env::temp_dir().join(format!("tundra-traversal-{}", uuid::Uuid::new_v4()));
    let vault_dir = base.join("vault");
    std::fs::create_dir_all(&vault_dir).unwrap();
    let outside = base.join("OUTSIDE");
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(outside.join("important.txt"), "user data").unwrap();
    (Vault::open(&vault_dir).unwrap(), outside)
}

const ESCAPES: [&str; 5] = [
    "../OUTSIDE",
    "../../OUTSIDE",
    "sub/../../OUTSIDE",
    "./../OUTSIDE",
    "..",
];

#[test]
fn create_folder_rejects_traversal() {
    let (vault, outside) = fixture();
    for bad in ESCAPES {
        assert!(
            vault.create_folder(&format!("{bad}/pwned")).is_err(),
            "create_folder accepted {bad:?}"
        );
    }
    assert!(!outside.join("pwned").exists());
}

#[test]
fn delete_folder_rejects_traversal() {
    let (vault, outside) = fixture();
    for bad in ESCAPES {
        assert!(
            vault.delete_folder(bad).is_err(),
            "delete_folder accepted {bad:?}"
        );
    }
    assert!(
        outside.join("important.txt").exists(),
        "data outside the vault was deleted"
    );
}

#[test]
fn move_folder_rejects_traversal() {
    let (vault, outside) = fixture();
    vault.create_folder("Real").unwrap();
    for bad in ESCAPES {
        assert!(
            vault.move_folder("Real", bad).is_err(),
            "move_folder accepted {bad:?} as a destination"
        );
    }
    assert!(!outside.join("Real").exists());
}

#[test]
fn rename_folder_rejects_a_name_that_is_a_path() {
    let (vault, outside) = fixture();
    vault.create_folder("Real").unwrap();
    for bad in ["../escaped", "..", ".", "a/b", "a\\b", ""] {
        assert!(
            vault.rename_folder("Real", bad).is_err(),
            "rename_folder accepted {bad:?} as a new name"
        );
    }
    assert!(!outside.join("escaped").exists());
}

#[test]
fn note_creation_and_moves_reject_traversal() {
    let (vault, outside) = fixture();
    for bad in ESCAPES {
        assert!(
            vault.create_note_in("Escaped", bad).is_err(),
            "create_note_in accepted {bad:?}"
        );
    }
    let note = vault.create_note_in("Legit", "").unwrap();
    for bad in ESCAPES {
        assert!(
            vault.move_note(&note.id, bad).is_err(),
            "move_note accepted {bad:?}"
        );
    }
    assert!(!outside.join("legit.json").exists());
}

/// Ordinary paths must keep working — the guard rejects traversal, not nesting.
#[test]
fn legitimate_nested_paths_still_work() {
    let (vault, _outside) = fixture();
    vault.create_folder("Biology/Plants/Ferns").unwrap();
    vault.create_note_in("Fern", "Biology/Plants/Ferns").unwrap();
    vault.rename_folder("Biology/Plants", "Flora").unwrap();
    vault.create_folder("").unwrap(); // the notes root
}
