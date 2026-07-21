//! Tauri command surface — the thin, typed boundary between TypeScript and the
//! Rust core (CLAUDE.md §6.1 `ipc`). These handlers hold NO business logic: they
//! resolve the open vault and delegate straight to `tundra-core`. Every command
//! is `#[specta::specta]` so `tauri-specta` can generate matching TS types.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_specta::Event;

use chrono::NaiveDate;

use tundra_core::{
    AttachmentKind, CalendarRange, CalendarStore, ChangeEvent, CoreError,
    Event as CalendarEvent, GraphData, KanbanBoard, KanbanStore, LinkIndex, Misspelling, Note,
    NoteDate, NoteSummary, SearchHit, SearchIndex, SpellChecker, TreeNode, Vault, VaultInfo, Watcher,
};

use crate::events::{NoteChangedExternally, TreeChanged};
use crate::AppState;

/// App-level config, stored in the OS app-config dir — NOT in the vault
/// (CLAUDE.md §5.1: App Data holds only app config + known-vault registry).
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    last_vault: Option<String>,
    /// Every vault the user has opened or created, across launches — the
    /// "list of known vaults" (CLAUDE.md §5.1) backing the Settings vault
    /// switcher. Most-recently-opened first; deduped by path.
    #[serde(default)]
    known_vaults: Vec<VaultInfo>,
}

/// Record `info` as the last-open vault and move it to the front of the
/// known-vaults list, deduped by path (re-opening an already-known vault
/// refreshes its stored name too, in case the folder was renamed on disk).
/// Pure — no IO — so it's unit-testable without touching the app-config dir.
fn apply_remember(cfg: &mut AppConfig, info: &VaultInfo) {
    cfg.known_vaults.retain(|v| v.path != info.path);
    cfg.known_vaults.insert(0, info.clone());
    cfg.last_vault = Some(info.path.clone());
}

/// Drop `path` from the known-vaults list ONLY — never touches the vault's
/// files on disk. Also clears `last_vault` if it pointed at the forgotten
/// vault, so a relaunch doesn't try to reopen it. Pure — no IO.
fn apply_forget(cfg: &mut AppConfig, path: &str) {
    cfg.known_vaults.retain(|v| v.path != path);
    if cfg.last_vault.as_deref() == Some(path) {
        cfg.last_vault = None;
    }
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

/// The calendar event store for the currently open vault (Phase 3 step 1).
fn current_calendar(state: &State<AppState>) -> Result<Arc<CalendarStore>, CoreError> {
    state
        .calendar
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| CoreError::Vault("no vault is open".into()))
}

/// The Kanban board store for the currently open vault (Phase 3+).
fn current_kanban(state: &State<AppState>) -> Result<Arc<KanbanStore>, CoreError> {
    state
        .kanban
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| CoreError::Vault("no vault is open".into()))
}

/// The spellchecker for the currently open vault (Phase 3 step 4).
fn current_spellcheck(state: &State<AppState>) -> Result<Arc<SpellChecker>, CoreError> {
    state
        .spellcheck
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

mod attachments;
mod backup;
mod calendar;
mod config;
mod folders;
mod import;
mod kanban;
mod links;
mod notes;
mod quicknotes;
mod search;
mod spellcheck;
mod tags;
mod templates;
mod vault;

pub use attachments::*;
pub use backup::*;
pub use calendar::*;
pub use config::*;
pub use folders::*;
pub use import::*;
pub use kanban::*;
pub use links::*;
pub use notes::*;
pub use quicknotes::*;
pub use search::*;
pub use spellcheck::*;
pub use tags::*;
pub use templates::*;
pub use vault::*;

#[cfg(test)]
mod tests;
