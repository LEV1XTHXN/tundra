use super::*;

use super::spellcheck::{enabled_languages, read_lang_dicts};

/// Suggested default vault location for the "don't make me think" path:
/// `{Documents}/Tundra` (CLAUDE.md §5.1).
#[tauri::command]
#[specta::specta]
pub fn default_vault_path(app: AppHandle) -> Result<String, CoreError> {
    let docs = app
        .path()
        .document_dir()
        .map_err(|e| CoreError::Vault(e.to_string()))?;
    Ok(docs.join("Tundra").to_string_lossy().into_owned())
}

/// The last vault opened, if any — lets the app skip onboarding on relaunch.
#[tauri::command]
#[specta::specta]
pub fn last_vault(app: AppHandle) -> Result<Option<String>, CoreError> {
    Ok(load_config(&app).last_vault)
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
/// disk are never touched. Use this to declutter the switcher after moving a
/// vault or abandoning one; to actually delete a vault, remove its folder
/// outside the app first.
#[tauri::command]
#[specta::specta]
pub fn forget_vault(app: AppHandle, path: String) -> Result<(), CoreError> {
    let mut cfg = load_config(&app);
    apply_forget(&mut cfg, &path);
    save_config(&app, &cfg)
}
