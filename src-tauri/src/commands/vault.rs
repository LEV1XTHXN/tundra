use super::*;

use super::spellcheck::{enabled_languages, read_lang_dicts};

/// Suggested default vault location for the "don't make me think" path:
/// `{Documents}/Tundra` (CLAUDE.md §5.1).
///
/// Falls back to `{Home}/Tundra` when there is no Documents directory: on Linux
/// `document_dir()` resolves through XDG user-dirs, which minimal installs and
/// containers don't configure — without the fallback the one-click onboarding
/// button just errors there. Windows and macOS always have a Documents folder.
#[tauri::command]
#[specta::specta]
pub fn default_vault_path(app: AppHandle) -> Result<String, CoreError> {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|e| CoreError::Vault(e.to_string()))?;
    Ok(base.join("Tundra").to_string_lossy().into_owned())
}

/// The last vault opened, if any — lets the app skip onboarding on relaunch.
#[tauri::command]
#[specta::specta]
pub fn last_vault(app: AppHandle) -> Result<Option<String>, CoreError> {
    Ok(load_config(&app).last_vault)
}

/// True when `requested` names the vault already open at `current`.
///
/// Compares canonicalized paths so a symlinked, trailing-slash or otherwise
/// differently-spelled path — e.g. whatever the native folder picker hands back
/// for a vault the app already has open — still counts as the same vault. Falls
/// back to raw string equality when canonicalization fails (path gone, no
/// permission), which is the honest answer with no filesystem to consult.
pub(super) fn is_same_vault(current: &str, requested: &str) -> bool {
    match (
        std::fs::canonicalize(current),
        std::fs::canonicalize(requested),
    ) {
        (Ok(a), Ok(b)) => a == b,
        _ => current == requested,
    }
}

/// Open (or create) the vault at `path`, remember it, and return its info.
#[tauri::command]
#[specta::specta]
pub fn open_vault(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<VaultInfo, CoreError> {
    // Serialize the whole operation — see `AppState::opening` for why.
    let _opening = state.opening.lock().unwrap();

    let vault = Vault::open(&path)?;
    let info = vault.info();

    // Grant the webview's asset protocol read access to this vault's whole
    // `attachments/` tree (icons + images/videos/files), so custom note icons
    // and embedded attachments can be displayed via `convertFileSrc` (services
    // layer) without opening the sandbox to the whole disk — the vault lives at
    // a user-chosen, arbitrary path, so this can't be a fixed scope declared up
    // front in tauri.conf.json.
    let attachments_dir = std::path::Path::new(&info.path).join("attachments");
    app.asset_protocol_scope()
        .allow_directory(&attachments_dir, true)
        .map_err(|e| CoreError::Io(e.to_string()))?;

    // Already open? Then there is nothing to do, and re-opening would in fact
    // BREAK the session: this process still holds every handle for that vault,
    // including the `SearchIndex`'s Tantivy `IndexWriter` and with it the
    // exclusive lock on `.vault/cache/search/`. Constructing a second writer for
    // the same directory below fails with `LockBusy`, and — since the old one is
    // only dropped at the state swap at the end — it fails on every retry too,
    // leaving the vault unopenable until the app restarts.
    //
    // The frontend does exactly this whenever it reboots under a Rust process
    // that did not: a webview reload re-runs the boot effect, which calls
    // `open_vault(last_vault)` again. Returning the info it already asked for is
    // both correct and what makes a reload recoverable. The asset-protocol scope
    // was re-granted just above, and this path is already at the front of the
    // known-vaults registry, so there is no bookkeeping left to redo.
    if let Some(open) = state.vault.lock().unwrap().as_ref() {
        if is_same_vault(&open.info().path, &info.path) {
            return Ok(info);
        }
    }

    // Open the search index and bring it up to date incrementally — not a
    // full rebuild every launch (Phase 1 step 9).
    let search = Arc::new(SearchIndex::open(std::path::Path::new(&info.path))?);
    search.catch_up(&vault)?;

    // Open the link index and catch it up the same way (Phase 2 step 2). Both
    // derived indexes live under .vault/cache/ and are rebuildable.
    let links = Arc::new(LinkIndex::open(std::path::Path::new(&info.path))?);
    links.catch_up(&vault)?;

    // Open the calendar event store (Phase 3 step 1). Unlike search/links this is
    // content (an in-vault file under .vault/config/), not a rebuildable cache.
    let calendar = CalendarStore::open(&vault)?;

    // Open the Kanban board store (Phase 3+) — content under .vault/config/, same
    // lifecycle as the calendar store.
    let kanban = KanbanStore::open(&vault)?;

    // Open the spellchecker (Phase 3 step 4): the vault's personal dictionary plus
    // the enabled language dictionaries, whose contents we read from the bundled
    // app resources (empty/inert until a real dictionary is bundled).
    let enabled = enabled_languages(&app);
    let lang_dicts = read_lang_dicts(&app, &enabled);
    let spellcheck = SpellChecker::open(&vault, &lang_dicts)?;

    // Watch this vault's notes/ tree for external changes (Phase 1 step 8),
    // replacing any watcher for a previously open vault — dropping it stops
    // its background thread. Also keeps the search AND link indexes current on
    // external changes (Phase 1 step 9 item 4 / Phase 2 step 2).
    let events_app = app.clone();
    let search_for_watcher = search.clone();
    let links_for_watcher = links.clone();
    let vault_for_watcher = vault.clone();
    let watcher = Watcher::watch(vault.clone(), move |event| {
        if let ChangeEvent::NoteChangedExternally { id } = &event {
            match vault_for_watcher.read_note(id) {
                Ok(note) => {
                    reindex_after_write(&vault_for_watcher, search_for_watcher.as_ref(), &note);
                    let _ = links_for_watcher.index_note(&note);
                }
                Err(_) => {
                    let _ = search_for_watcher.remove_note(id);
                    let _ = links_for_watcher.remove_note(id);
                }
            }
        }
        let _ = match event {
            ChangeEvent::TreeChanged => TreeChanged.emit(&events_app),
            ChangeEvent::NoteChangedExternally { id } => NoteChangedExternally { id }.emit(&events_app),
        };
    })
    .map_err(|e| CoreError::Io(e.to_string()))?;

    *state.vault.lock().unwrap() = Some(vault);
    *state.watcher.lock().unwrap() = Some(watcher);
    *state.search.lock().unwrap() = Some(search);
    *state.links.lock().unwrap() = Some(links);
    *state.calendar.lock().unwrap() = Some(calendar);
    *state.kanban.lock().unwrap() = Some(kanban);
    *state.spellcheck.lock().unwrap() = Some(spellcheck);
    let mut cfg = load_config(&app);
    apply_remember(&mut cfg, &info);
    save_config(&app, &cfg)?;
    Ok(info)
}

/// Info about the currently open vault, or `None` if onboarding is needed.
#[tauri::command]
#[specta::specta]
pub fn current_vault(state: State<AppState>) -> Result<Option<VaultInfo>, CoreError> {
    Ok(state.vault.lock().unwrap().as_ref().map(|v| v.info()))
}

/// Every vault the user has opened or created, most-recently-opened first —
/// the known-vaults registry (CLAUDE.md §5.1) backing the Settings vault
/// switcher. Switching to one of these is just `open_vault` with its path.
#[tauri::command]
#[specta::specta]
pub fn list_known_vaults(app: AppHandle) -> Result<Vec<VaultInfo>, CoreError> {
    Ok(load_config(&app).known_vaults)
}

/// Remove `path` from the known-vaults registry ONLY — the vault's files on
/// disk are never touched. Used internally by `delete_vault` after the folder
/// is gone; not exposed as a command of its own, since "remove from the list
/// but keep the files" isn't an action the UI offers.
fn forget_vault(app: &AppHandle, path: &str) -> Result<(), CoreError> {
    let mut cfg = load_config(app);
    apply_forget(&mut cfg, path);
    save_config(app, &cfg)
}

/// Decide whether `path` may be deleted at all, before anything touches the
/// filesystem. Split out of `delete_vault` (and kept free of `AppHandle`) so
/// the guards on the app's most destructive operation are unit-testable.
///
/// `reserved` are directories that must never be deleted even when they look
/// like a vault — the user's home and Documents folders, which they may well
/// have picked as a vault root at some point.
pub(super) fn ensure_deletable(
    cfg: &AppConfig,
    path: &str,
    reserved: &[std::path::PathBuf],
) -> Result<(), CoreError> {
    // Only vaults the user actually knows about can be deleted. This keeps the
    // command surface from being a "recursively trash any directory" primitive:
    // the only paths that ever reach the filesystem are ones the app itself put
    // in the registry. Exact string match, the same comparison `apply_forget`
    // uses — so a path that passes here is also one it can remove.
    if !cfg.known_vaults.iter().any(|v| v.path == path) {
        return Err(CoreError::Vault(format!(
            "{path} is not a known vault — refusing to delete it"
        )));
    }

    // A vault root is an arbitrary user-chosen folder, so nothing stops someone
    // from having pointed the app at their home or Documents directory: those
    // then hold a legitimate `.vault/`, and the core's guard would happily trash
    // the lot. Deleting either is not a mistake anyone recovers from casually,
    // so refuse and let them do it deliberately outside the app.
    for dir in reserved {
        if is_same_vault(path, &dir.to_string_lossy()) {
            return Err(CoreError::Vault(format!(
                "{path} is your {} folder — delete it yourself if you really mean to",
                dir.display()
            )));
        }
    }
    Ok(())
}

/// Delete the vault at `path`: move its whole folder to the OS trash and drop
/// it from the known-vaults registry. Returns `true` when the deleted vault was
/// the one currently open — the frontend uses that to fall back to onboarding.
///
/// Deleting the OPEN vault is allowed, which is why this tears the session down
/// first (see below). Everything about this command is written on the
/// assumption that it is the most destructive thing the app can do: the core's
/// `trash_vault_dir` refuses anything that isn't recognisably a vault, and the
/// two guards here refuse anything the *app* has no business deleting.
#[tauri::command]
#[specta::specta]
pub fn delete_vault(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<bool, CoreError> {
    // Serialize against `open_vault` — a delete interleaved with an open could
    // tear down handles the open just installed, or trash a folder a concurrent
    // `Vault::open` is busy re-creating.
    let _opening = state.opening.lock().unwrap();

    let reserved: Vec<std::path::PathBuf> = [app.path().home_dir(), app.path().document_dir()]
        .into_iter()
        .flatten()
        .collect();
    ensure_deletable(&load_config(&app), &path, &reserved)?;

    // If this is the open vault, release every handle on it BEFORE touching the
    // filesystem. Order matters: the watcher's callback owns clones of the
    // search and link `Arc`s (see `open_vault`), so dropping the watcher first
    // is what actually lets the `SearchIndex` drop — and with it Tantivy's
    // exclusive lock on `.vault/cache/search/`, which Windows will not let us
    // move a directory out from under.
    let was_open = state
        .vault
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|v| is_same_vault(&v.info().path, &path));
    if was_open {
        *state.watcher.lock().unwrap() = None;
        *state.search.lock().unwrap() = None;
        *state.links.lock().unwrap() = None;
        *state.calendar.lock().unwrap() = None;
        *state.kanban.lock().unwrap() = None;
        *state.spellcheck.lock().unwrap() = None;
        *state.vault.lock().unwrap() = None;
    }

    tundra_core::trash_vault_dir(std::path::Path::new(&path))?;

    // Only now forget it: if trashing failed we kept the entry, so the user can
    // see the error and try again rather than losing track of a vault that is
    // still on disk.
    forget_vault(&app, &path)?;
    Ok(was_open)
}
