//! Tauri command surface — the thin, typed boundary between TypeScript and the
//! Rust core (CLAUDE.md §6.1 `ipc`). These handlers hold NO business logic: they
//! resolve the open vault and delegate straight to `tundra-core`. Every command
//! is `#[specta::specta]` so `tauri-specta` can generate matching TS types.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_specta::Event;

use tundra_core::{
    AttachmentKind, ChangeEvent, CoreError, GraphData, LinkIndex, Note, NoteSummary, SearchHit,
    SearchIndex, TreeNode, Vault, VaultInfo, Watcher,
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

/// The link index for the currently open vault (Phase 2 step 2).
fn current_links(state: &State<AppState>) -> Result<Arc<LinkIndex>, CoreError> {
    state
        .links
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
    let _ = current_links(&state)?.index_note(&note);
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
    let _ = current_links(&state)?.index_note(&note);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn delete_note(state: State<AppState>, id: String) -> Result<(), CoreError> {
    current(&state)?.delete_note(&id)?;
    let _ = current_search(&state)?.remove_note(&id);
    let _ = current_links(&state)?.remove_note(&id);
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

/// Import an attachment by content (Phase 2 step 1): the frontend reads a
/// browser `File`'s bytes and forwards them here; the core hashes them (blake3),
/// stores them content-addressed under `attachments/<kind>/`, and returns the
/// vault-relative path the editor stores in the embedding block. No attachment
/// bytes are ever written from the frontend.
#[tauri::command]
#[specta::specta]
pub fn import_attachment(
    state: State<AppState>,
    kind: AttachmentKind,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, CoreError> {
    current(&state)?.import_attachment(kind, &file_name, &bytes)
}

/// Read the single quick-note scratchpad (Phase 2 step 5), or a fresh empty one
/// if nothing's been captured yet. It's not one of the vault's notes — it lives
/// in its own file and never appears in the tree/search/graph.
#[tauri::command]
#[specta::specta]
pub fn read_quick_note(state: State<AppState>) -> Result<Note, CoreError> {
    current(&state)?.read_quick_note()
}

/// Persist the quick-note scratchpad. Deliberately does NOT touch the search or
/// link indexes — the quick note is outside the notes tree.
#[tauri::command]
#[specta::specta]
pub fn save_quick_note(state: State<AppState>, note: Note) -> Result<(), CoreError> {
    current(&state)?.save_quick_note(note)
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
    let _ = current_links(&state)?.index_note(&note);
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

/// Notes that link *to* `id` (incoming links), as current summaries — the
/// editor's backlinks panel (Phase 2 step 2).
#[tauri::command]
#[specta::specta]
pub fn backlinks(state: State<AppState>, id: String) -> Result<Vec<NoteSummary>, CoreError> {
    Ok(current_links(&state)?.backlinks(&current(&state)?, &id))
}

/// The whole directed link graph (nodes = notes, edges = resolved links) for
/// the graph view (Phase 2 step 2/4). Broken links are excluded.
#[tauri::command]
#[specta::specta]
pub fn graph_data(state: State<AppState>) -> Result<GraphData, CoreError> {
    current_links(&state)?.graph_data(&current(&state)?)
}

/// Resolve note ids to their CURRENT summaries (title/icon) — for live link
/// labels; ids that no longer resolve are omitted (the caller uses the stored
/// label for those).
#[tauri::command]
#[specta::specta]
pub fn resolve_titles(state: State<AppState>, ids: Vec<String>) -> Result<Vec<NoteSummary>, CoreError> {
    Ok(current_links(&state)?.resolve_titles(&current(&state)?, &ids))
}

/// Rebuild the link graph from the notes on disk (recovery action — the graph
/// cache is derived/rebuildable).
#[tauri::command]
#[specta::specta]
pub fn rebuild_graph(state: State<AppState>) -> Result<(), CoreError> {
    current_links(&state)?.rebuild(&current(&state)?)
}

/// Read a vault-scoped config file under `.vault/config/<name>` (Phase 2 step 4:
/// graph view settings; step 6: home dashboard layout). Returns the raw JSON
/// string, or `None` if it hasn't been written yet — the caller parses it. This
/// keeps vault UI state out of `localStorage` and in the vault where it can sync
/// (CLAUDE.md §4/§5.2).
#[tauri::command]
#[specta::specta]
pub fn read_vault_config(state: State<AppState>, name: String) -> Result<Option<String>, CoreError> {
    current(&state)?.read_config(&name)
}

/// Write a vault-scoped config file under `.vault/config/<name>` atomically —
/// the FS counterpart of `read_vault_config`.
#[tauri::command]
#[specta::specta]
pub fn write_vault_config(
    state: State<AppState>,
    name: String,
    contents: String,
) -> Result<(), CoreError> {
    current(&state)?.write_config(&name, &contents)
}

/// Path to an app-scoped settings blob at `{app_config_dir}/settings/<name>.json`.
/// App settings are *global* preferences (keybindings, and later appearance/etc.)
/// that persist across vaults — NOT vault content (CLAUDE.md §5.1). `name` is
/// restricted to a bare identifier so a caller can never traverse out of the
/// settings dir.
fn app_settings_path(app: &AppHandle, name: &str) -> Result<std::path::PathBuf, CoreError> {
    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(CoreError::Vault(format!("invalid settings name: {name:?}")));
    }
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| CoreError::Io(e.to_string()))?
        .join("settings");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join(format!("{name}.json")))
}

/// Read an app-scoped settings blob (a global preference that persists across
/// vaults), or `None` if it hasn't been written yet. Returns the raw JSON string;
/// the caller parses it (mirrors `read_vault_config`, but app- not vault-scoped).
#[tauri::command]
#[specta::specta]
pub fn read_app_settings(app: AppHandle, name: String) -> Result<Option<String>, CoreError> {
    let path = app_settings_path(&app, &name)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Write an app-scoped settings blob atomically (temp file + rename, so a crash
/// mid-write never truncates an existing file) — the FS counterpart of
/// `read_app_settings`.
#[tauri::command]
#[specta::specta]
pub fn write_app_settings(app: AppHandle, name: String, contents: String) -> Result<(), CoreError> {
    let path = app_settings_path(&app, &name)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, contents.as_bytes())?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use tauri::Manager;
    use tundra_core::Block;

    fn temp_vault_state() -> AppState {
        let dir = std::env::temp_dir().join(format!("tundra-cmd-test-{}", uuid::Uuid::new_v4()));
        let vault = Vault::open(&dir).expect("open temp vault");
        let search = SearchIndex::open(&dir).expect("open temp search index");
        let links = LinkIndex::open(&dir).expect("open temp link index");
        AppState {
            vault: Mutex::new(Some(vault)),
            search: Mutex::new(Some(Arc::new(search))),
            links: Mutex::new(Some(Arc::new(links))),
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

    /// Phase 2 step 1 acceptance at the command boundary: importing an image
    /// through the command stores it content-addressed under
    /// `attachments/images/<shard>/`, and a note embedding that attachment
    /// alongside a table survives a save → reload unchanged (persistence).
    #[test]
    fn import_attachment_and_embed_survive_reload_through_commands() {
        let app = tauri::test::mock_builder()
            .manage(temp_vault_state())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("failed to build mock app");
        let state: State<AppState> = app.state();

        // Import an image by content, exactly as the editor's uploadFile does.
        let png = b"\x89PNG demo bytes".to_vec();
        let rel = import_attachment(state.clone(), AttachmentKind::Image, "photo.png".into(), png.clone())
            .expect("import_attachment");
        assert!(rel.replace('\\', "/").starts_with("attachments/images/"));

        // Build a note with an image embed (storing the vault-relative path +
        // original filename) and a table block, then persist it.
        let mut note = create_note(state.clone(), "Rich".into()).expect("create_note");
        note.blocks = vec![
            Block {
                id: "img-1".into(),
                block_type: "image".into(),
                props: Some(serde_json::json!({ "url": rel, "name": "photo.png" })),
                content: None,
                children: vec![],
            },
            Block {
                id: "tbl-1".into(),
                block_type: "table".into(),
                props: None,
                content: Some(serde_json::json!({
                    "type": "tableContent",
                    "rows": [{ "cells": ["a", "b"] }]
                })),
                children: vec![],
            },
        ];
        save_note(state.clone(), note.clone()).expect("save_note");

        // Reload from disk: both the image embed (with its stored path) and the
        // table must come back intact.
        let reread = read_note(state.clone(), note.id.clone()).expect("read_note");
        assert_eq!(reread.blocks.len(), 2);
        assert_eq!(reread.blocks[0].block_type, "image");
        assert_eq!(reread.blocks[0].props.as_ref().unwrap()["url"], serde_json::json!(rel));
        assert_eq!(reread.blocks[1].block_type, "table");
        assert!(reread.blocks[1].content.is_some());
    }

    /// Phase 2 step 5 acceptance at the command boundary: the quick note is a
    /// standalone scratchpad — it round-trips through save/read but never enters
    /// the notes listing.
    #[test]
    fn quick_note_scratchpad_through_commands_is_not_a_vault_note() {
        let app = tauri::test::mock_builder()
            .manage(temp_vault_state())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("failed to build mock app");
        let state: State<AppState> = app.state();

        let mut quick = read_quick_note(state.clone()).expect("read_quick_note");
        quick.blocks = vec![Block {
            id: "b1".into(),
            block_type: "paragraph".into(),
            props: None,
            content: Some(serde_json::json!([{ "type": "text", "text": "capture", "styles": {} }])),
            children: vec![],
        }];
        save_quick_note(state.clone(), quick.clone()).expect("save_quick_note");

        let reread = read_quick_note(state.clone()).expect("re-read");
        assert_eq!(reread.blocks[0].content, quick.blocks[0].content);

        // It must not appear among the vault's notes.
        assert!(list_notes(state).expect("list_notes").is_empty());
    }

    /// Phase 2 step 2 acceptance at the command boundary: an id-backed link
    /// drives backlinks + graph_data, a rename does NOT rewrite the referrer,
    /// and title resolution returns the current title.
    #[test]
    fn links_backlinks_graph_and_rename_through_commands() {
        let app = tauri::test::mock_builder()
            .manage(temp_vault_state())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("failed to build mock app");
        let state: State<AppState> = app.state();

        let target = create_note(state.clone(), "Target".into()).expect("create target");
        let mut referrer = create_note(state.clone(), "Referrer".into()).expect("create referrer");
        referrer.blocks = vec![Block {
            id: "b1".into(),
            block_type: "paragraph".into(),
            props: None,
            content: Some(serde_json::json!([
                { "type": "text", "text": "see ", "styles": {} },
                { "type": tundra_core::LINK_INLINE_TYPE,
                  "props": { "noteId": target.id, "label": "Target" } }
            ])),
            children: vec![],
        }];
        save_note(state.clone(), referrer.clone()).expect("save referrer");

        // Backlinks of the target include the referrer.
        let back = backlinks(state.clone(), target.id.clone()).expect("backlinks");
        assert_eq!(back.iter().map(|s| s.id.clone()).collect::<Vec<_>>(), vec![referrer.id.clone()]);

        // Graph has both notes and the one resolved edge.
        let graph = graph_data(state.clone()).expect("graph_data");
        assert_eq!(graph.nodes.len(), 2);
        assert_eq!(graph.edges.len(), 1);
        assert_eq!(graph.edges[0].source, referrer.id);
        assert_eq!(graph.edges[0].target, target.id);

        // Rename the target; the referrer file must be untouched (no repair),
        // and title resolution reflects the NEW title.
        let mut renamed = read_note(state.clone(), target.id.clone()).expect("read target");
        renamed.title = "Renamed Target".into();
        save_note(state.clone(), renamed).expect("save renamed");

        let referrer_after = read_note(state.clone(), referrer.id.clone()).expect("read referrer");
        assert_eq!(referrer_after.blocks[0].content, referrer.blocks[0].content,
            "referrer must not be rewritten on target rename");
        let resolved = resolve_titles(state.clone(), vec![target.id.clone()]).expect("resolve");
        assert_eq!(resolved[0].title, "Renamed Target");
    }
}
