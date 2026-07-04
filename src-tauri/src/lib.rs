//! Tundra desktop shell — the thin Tauri front door over `tundra-core`.
//!
//! Responsibilities here are strictly: wire commands, manage the open-vault
//! state, and generate the typed TS bindings. No business logic (CLAUDE.md §2).

mod commands;
mod events;

use std::sync::{Arc, Mutex};

use tauri_specta::{collect_commands, collect_events, Builder};
use tundra_core::{LinkIndex, SearchIndex, Vault, Watcher};

/// Managed application state: the single currently-open vault, its file
/// watcher (Phase 1 step 8), its search index (Phase 1 step 9), and its link
/// index (Phase 2 step 2) — all replaced, not accumulated, whenever a different
/// vault is opened; dropping the old watcher stops it.
#[derive(Default)]
pub struct AppState {
    pub vault: Mutex<Option<Vault>>,
    pub watcher: Mutex<Option<Watcher>>,
    pub search: Mutex<Option<Arc<SearchIndex>>>,
    pub links: Mutex<Option<Arc<LinkIndex>>>,
    /// Held for the whole `open_vault` operation (not just the state swap at
    /// the end) so two overlapping calls — e.g. a duplicate IPC call — can
    /// never both construct a `SearchIndex` for the same directory at once,
    /// which races for Tantivy's directory lock and fails with `LockBusy`.
    pub opening: Mutex<()>,
}

/// TypeScript export config. Block `props`/`content` are already exported as
/// `any` (see `tundra_core::document`), so the default exporter is all we need.
fn ts_exporter() -> specta_typescript::Typescript {
    specta_typescript::Typescript::default()
}

/// The `tauri-specta` builder — the one source of truth for the command +
/// event set, shared by `run()` (to mount them) and the bindings-export test.
fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::default_vault_path,
            commands::last_vault,
            commands::open_vault,
            commands::current_vault,
            commands::list_notes,
            commands::create_note,
            commands::create_note_in,
            commands::read_quick_note,
            commands::save_quick_note,
            commands::read_note,
            commands::save_note,
            commands::delete_note,
            commands::move_note,
            commands::list_tree,
            commands::create_folder,
            commands::rename_folder,
            commands::move_folder,
            commands::delete_folder,
            commands::import_icon,
            commands::import_attachment,
            commands::search_query,
            commands::rebuild_index,
            commands::backlinks,
            commands::graph_data,
            commands::resolve_titles,
            commands::rebuild_graph,
            commands::read_vault_config,
            commands::write_vault_config,
            commands::read_app_settings,
            commands::write_app_settings,
        ])
        .events(collect_events![events::TreeChanged, events::NoteChangedExternally])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = specta_builder();

    // In dev, regenerate the TypeScript bindings on every launch so the
    // frontend contract can never drift from the Rust commands (CLAUDE.md §8.2).
    #[cfg(debug_assertions)]
    builder
        .export(ts_exporter(), "../src/services/bindings.ts")
        .expect("failed to export typescript bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    /// Generates `src/services/bindings.ts` without launching the GUI, so the
    /// typed contract can be produced in headless/CI environments too.
    #[test]
    fn export_bindings() {
        super::specta_builder()
            .export(super::ts_exporter(), "../src/services/bindings.ts")
            .expect("failed to export typescript bindings");
    }
}
