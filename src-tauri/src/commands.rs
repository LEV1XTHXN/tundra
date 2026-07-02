//! Tauri command surface — the thin, typed boundary between TypeScript and the
//! Rust core (CLAUDE.md §6.1 `ipc`). These handlers hold NO business logic: they
//! resolve the open vault and delegate straight to `tundra-core`. Every command
//! is `#[specta::specta]` so `tauri-specta` can generate matching TS types.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_specta::Event;

use tundra_core::{
    ChangeEvent, CoreError, Note, NoteSummary, SearchHit, SearchIndex, TreeNode, Vault, VaultInfo,
    Watcher,
};

use crate::events::{NoteChangedExternally, TreeChanged};
use crate::AppState;

/// App-level config, stored in the OS app-config dir — NOT in the vault
/// (CLAUDE.md §5.1: App Data holds only app config + known-vault registry).
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    last_vault: Option<String>,
}

fn config_path(app: &AppHandle) -> Result<std::path::PathBuf, CoreError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| CoreError::Io(e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("state.json"))
}

fn load_config(app: &AppHandle) -> AppConfig {
    config_path(app)
        .and_then(|p| Ok(std::fs::read(p)?))
        .and_then(|b| Ok(serde_json::from_slice(&b)?))
        .unwrap_or_default()
}

fn save_config(app: &AppHandle, cfg: &AppConfig) -> Result<(), CoreError> {
    let path = config_path(app)?;
    std::fs::write(path, serde_json::to_vec_pretty(cfg)?)?;
    Ok(())
}

/// Clone the currently-open vault out of managed state (cheap — just a PathBuf),
/// so we never hold the lock across filesystem IO.
fn current(state: &State<AppState>) -> Result<Vault, CoreError> {
    state
        .vault
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| CoreError::Vault("no vault is open".into()))
}

/// The search index for the currently open vault (Phase 1 step 9).
fn current_search(state: &State<AppState>) -> Result<Arc<SearchIndex>, CoreError> {
    state
        .search
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| CoreError::Vault("no vault is open".into()))
}

/// (Re)index one note after a successful write — called from every command
/// that persists note content, so search stays correct without waiting for
/// the next catch-up (Phase 1 step 9: "after a successful save, (re)index
/// that one note"). Best-effort: search staying briefly stale is better than
/// failing the write the user actually asked for.
fn reindex_after_write(vault: &Vault, search: &SearchIndex, note: &Note) {
    let path = vault.note_summary(&note.id).map(|s| s.path).unwrap_or_default();
    let _ = search.index_note(note, &path);
}

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

    // Grant the webview's asset protocol read access to this vault's icon
    // library, so custom note icons can be displayed via `convertFileSrc`
    // (services layer) without opening the sandbox to the whole disk — the
    // vault lives at a user-chosen, arbitrary path, so this can't be a fixed
    // scope declared up front in tauri.conf.json.
    let icons_dir = std::path::Path::new(&info.path).join("attachments/icons");
    app.asset_protocol_scope()
        .allow_directory(&icons_dir, true)
        .map_err(|e| CoreError::Io(e.to_string()))?;

    // Open the search index and bring it up to date incrementally — not a
    // full rebuild every launch (Phase 1 step 9).
    let search = Arc::new(SearchIndex::open(std::path::Path::new(&info.path))?);
    search.catch_up(&vault)?;

    // Watch this vault's notes/ tree for external changes (Phase 1 step 8),
    // replacing any watcher for a previously open vault — dropping it stops
    // its background thread. Also keeps search current on external changes
    // (Phase 1 step 9 item 4).
    let events_app = app.clone();
    let search_for_watcher = search.clone();
    let vault_for_watcher = vault.clone();
    let watcher = Watcher::watch(vault.clone(), move |event| {
        if let ChangeEvent::NoteChangedExternally { id } = &event {
            match vault_for_watcher.read_note(id) {
                Ok(note) => reindex_after_write(&vault_for_watcher, search_for_watcher.as_ref(), &note),
                Err(_) => {
                    let _ = search_for_watcher.remove_note(id);
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
    save_config(
        &app,
        &AppConfig {
            last_vault: Some(info.path.clone()),
        },
    )?;
    Ok(info)
}

/// Info about the currently open vault, or `None` if onboarding is needed.
#[tauri::command]
#[specta::specta]
pub fn current_vault(state: State<AppState>) -> Result<Option<VaultInfo>, CoreError> {
    Ok(state.vault.lock().unwrap().as_ref().map(|v| v.info()))
}

#[tauri::command]
#[specta::specta]
pub fn list_notes(state: State<AppState>) -> Result<Vec<NoteSummary>, CoreError> {
    current(&state)?.list_notes()
}

#[tauri::command]
#[specta::specta]
pub fn create_note(state: State<AppState>, title: String) -> Result<Note, CoreError> {
    let vault = current(&state)?;
    let note = vault.create_note(&title)?;
    reindex_after_write(&vault, current_search(&state)?.as_ref(), &note);
    Ok(note)
}

#[tauri::command]
#[specta::specta]
pub fn read_note(state: State<AppState>, id: String) -> Result<Note, CoreError> {
    current(&state)?.read_note(&id)
}

#[tauri::command]
#[specta::specta]
pub fn save_note(state: State<AppState>, note: Note) -> Result<(), CoreError> {
    let vault = current(&state)?;
    vault.save_note(note.clone())?;
    reindex_after_write(&vault, current_search(&state)?.as_ref(), &note);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn delete_note(state: State<AppState>, id: String) -> Result<(), CoreError> {
    current(&state)?.delete_note(&id)?;
    let _ = current_search(&state)?.remove_note(&id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn move_note(state: State<AppState>, id: String, new_folder: String) -> Result<(), CoreError> {
    current(&state)?.move_note(&id, &new_folder)
}

/// The folder/note tree for the open vault.
#[tauri::command]
#[specta::specta]
pub fn list_tree(state: State<AppState>) -> Result<Vec<TreeNode>, CoreError> {
    Ok(current(&state)?.list_tree())
}

#[tauri::command]
#[specta::specta]
pub fn create_folder(state: State<AppState>, path: String) -> Result<(), CoreError> {
    current(&state)?.create_folder(&path)
}

#[tauri::command]
#[specta::specta]
pub fn rename_folder(
    state: State<AppState>,
    path: String,
    new_name: String,
) -> Result<(), CoreError> {
    current(&state)?.rename_folder(&path, &new_name)
}

#[tauri::command]
#[specta::specta]
pub fn move_folder(
    state: State<AppState>,
    path: String,
    new_parent: String,
) -> Result<(), CoreError> {
    current(&state)?.move_folder(&path, &new_parent)
}

#[tauri::command]
#[specta::specta]
pub fn delete_folder(state: State<AppState>, path: String) -> Result<(), CoreError> {
    current(&state)?.delete_folder(&path)
}

/// Copy `src_path` (chosen via the native file dialog in `services`) into
/// `attachments/icons/`, returning its vault-relative path for `Icon::Custom`.
#[tauri::command]
#[specta::specta]
pub fn import_icon(state: State<AppState>, src_path: String) -> Result<String, CoreError> {
    current(&state)?.import_icon(std::path::Path::new(&src_path))
}

/// Create a note directly inside `folder` (relative to the notes root, `""`
/// for the root) — the "new note in the selected folder" nav action.
#[tauri::command]
#[specta::specta]
pub fn create_note_in(
    state: State<AppState>,
    title: String,
    folder: String,
) -> Result<Note, CoreError> {
    let vault = current(&state)?;
    let note = vault.create_note_in(&title, &folder)?;
    reindex_after_write(&vault, current_search(&state)?.as_ref(), &note);
    Ok(note)
}

/// Ranked full-text search hits (id, title, snippet) for `query`.
#[tauri::command]
#[specta::specta]
pub fn search_query(state: State<AppState>, query: String, limit: u32) -> Result<Vec<SearchHit>, CoreError> {
    current_search(&state)?.search(&query, limit as usize)
}

/// Rebuild the search index from scratch (a user-triggered recovery action —
/// the index is derived/rebuildable, never a source of truth).
#[tauri::command]
#[specta::specta]
pub fn rebuild_index(state: State<AppState>) -> Result<(), CoreError> {
    current_search(&state)?.rebuild(&current(&state)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use tauri::Manager;

    fn temp_vault_state() -> AppState {
        let dir = std::env::temp_dir().join(format!("tundra-cmd-test-{}", uuid::Uuid::new_v4()));
        let vault = Vault::open(&dir).expect("open temp vault");
        let search = SearchIndex::open(&dir).expect("open temp search index");
        AppState {
            vault: Mutex::new(Some(vault)),
            search: Mutex::new(Some(Arc::new(search))),
            ..Default::default()
        }
    }

    fn tree_contains_note(nodes: &[TreeNode], id: &str) -> bool {
        nodes.iter().any(|n| match n {
            TreeNode::Note(s) => s.id == id,
            TreeNode::Folder(f) => tree_contains_note(&f.children, id),
        })
    }

    /// Smoke test for the command wiring itself (not re-testing vault logic,
    /// already covered in tundra-core): drives the commands exactly as the
    /// frontend would, through `tauri::test`'s mock runtime.
    #[test]
    fn smoke_create_list_move_delete_through_commands() {
        let app = tauri::test::mock_builder()
            .manage(temp_vault_state())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("failed to build mock app");
        let state: State<AppState> = app.state();

        let note = create_note(state.clone(), "Alpha".into()).expect("create_note");
        let tree = list_tree(state.clone()).expect("list_tree");
        assert!(tree_contains_note(&tree, &note.id));

        create_folder(state.clone(), "Folder".into()).expect("create_folder");
        move_note(state.clone(), note.id.clone(), "Folder".into()).expect("move_note");
        let tree = list_tree(state.clone()).expect("list_tree after move");
        let folder = tree
            .iter()
            .find_map(|n| match n {
                TreeNode::Folder(f) if f.name == "Folder" => Some(f),
                _ => None,
            })
            .expect("Folder present in tree");
        assert!(tree_contains_note(&folder.children, &note.id));

        delete_note(state.clone(), note.id.clone()).expect("delete_note");
        let tree = list_tree(state).expect("list_tree after delete");
        assert!(!tree_contains_note(&tree, &note.id));
    }
}
