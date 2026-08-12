//! Deleting a vault is the most destructive thing the app does — it takes an
//! arbitrary absolute path and recursively removes the whole folder. These
//! tests pin the guards that decide a path is *not* eligible.
//!
//! The happy path (a real vault actually reaching the trash) is deliberately
//! not tested here: it would need `XDG_DATA_HOME` overridden process-wide,
//! which races every other test in the binary. It's covered manually.
use tundra_core::{trash_vault_dir, Vault};

fn temp_dir() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("tundra-delete-guard-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// The guard that matters most: a folder without `.vault/` was never a vault
/// this app created, so a stale registry entry — or a folder replaced since it
/// was registered — must not take the user's unrelated files with it.
#[test]
fn refuses_a_directory_that_is_not_a_vault() {
    let dir = temp_dir();
    std::fs::write(dir.join("important.txt"), "user data").unwrap();

    assert!(trash_vault_dir(&dir).is_err());
    assert!(
        dir.join("important.txt").exists(),
        "a directory that is not a vault was deleted"
    );

    std::fs::remove_dir_all(&dir).ok();
}

/// Guards look at `.vault/` as a *directory* — a decoy file by that name is
/// not a vault either.
#[test]
fn refuses_a_directory_whose_dot_vault_is_a_file() {
    let dir = temp_dir();
    std::fs::write(dir.join(".vault"), "not a directory").unwrap();

    assert!(trash_vault_dir(&dir).is_err());
    assert!(dir.join(".vault").exists());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn refuses_a_regular_file() {
    let dir = temp_dir();
    let file = dir.join("notes.json");
    std::fs::write(&file, "{}").unwrap();

    assert!(trash_vault_dir(&file).is_err());
    assert!(file.exists(), "a regular file was deleted");

    std::fs::remove_dir_all(&dir).ok();
}

/// A vault the user already deleted outside the app is not an error: the
/// caller still needs to clear it from the known-vaults registry.
#[test]
fn a_missing_path_succeeds_so_the_registry_can_be_cleaned_up() {
    let dir = temp_dir();
    let gone = dir.join("never-existed");

    assert!(trash_vault_dir(&gone).is_ok());

    std::fs::remove_dir_all(&dir).ok();
}

/// The real thing: a vault actually reaching the OS trash. `#[ignore]`d because
/// it writes to the developer's own trash can (it cleans up after itself) and
/// because a headless CI box may have no trash implementation at all — the
/// point is to be able to confirm, on demand, that the platform backend works:
///
/// ```text
/// cargo test -p tundra-core --test vault_delete_guards -- --ignored
/// ```
#[test]
#[ignore = "writes to the real OS trash; run explicitly"]
fn a_real_vault_actually_reaches_the_trash() {
    // Under $HOME so the trash used is the home one, which we can verify and
    // clean up — a vault in /tmp may land in a tmpfs-local .Trash-$uid instead.
    let home = std::path::PathBuf::from(std::env::var("HOME").expect("HOME"));
    let name = format!("tundra-trash-check-{}", uuid::Uuid::new_v4());
    let vault_dir = home.join(&name);
    Vault::open(&vault_dir).unwrap();
    std::fs::write(vault_dir.join("notes").join("canary.json"), "{}").unwrap();

    trash_vault_dir(&vault_dir).expect("trashing a vault must work on this platform");
    assert!(!vault_dir.exists(), "the vault folder is still in place");

    let trashed = home.join(".local/share/Trash/files").join(&name);
    assert!(trashed.is_dir(), "the vault is not in {}", trashed.display());
    assert!(trashed.join("notes/canary.json").exists(), "contents were not preserved");

    // Put the trash back the way we found it.
    std::fs::remove_dir_all(&trashed).ok();
    std::fs::remove_file(home.join(".local/share/Trash/info").join(format!("{name}.trashinfo"))).ok();
}

/// Positive control: a genuine vault passes every guard. Stops short of the
/// trash call itself (see the module comment) — this asserts the layout
/// `Vault::open` creates is what the guards recognise, so a future change to
/// `DIRS` can't silently make every vault undeletable.
#[test]
fn a_real_vault_passes_the_guards() {
    let dir = temp_dir();
    let vault_dir = dir.join("MyVault");
    let vault = Vault::open(&vault_dir).unwrap();

    assert!(
        vault.root().join(".vault").is_dir(),
        "Vault::open no longer creates the .vault marker the delete guard looks for"
    );
    assert!(vault_dir.is_dir() && vault_dir.parent().is_some());

    std::fs::remove_dir_all(&dir).ok();
}
