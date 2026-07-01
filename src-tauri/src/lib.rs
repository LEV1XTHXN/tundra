//! Tundra desktop shell — the thin Tauri front door over `tundra-core`.
//!
//! Responsibilities here are strictly: wire commands, manage the open-vault
//! state, and generate the typed TS bindings. No business logic (CLAUDE.md §2).

mod commands;

use std::sync::Mutex;

use tauri_specta::{collect_commands, Builder};
use tundra_core::Vault;

/// Managed application state: the single currently-open vault.
#[derive(Default)]
pub struct AppState {
    pub vault: Mutex<Option<Vault>>,
}

/// TypeScript export config. Block `props`/`content` are already exported as
/// `any` (see `tundra_core::document`), so the default exporter is all we need.
fn ts_exporter() -> specta_typescript::Typescript {
    specta_typescript::Typescript::default()
}

/// The `tauri-specta` builder — the one source of truth for the command set,
/// shared by `run()` (to mount them) and the bindings-export test.
fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![
        commands::default_vault_path,
        commands::last_vault,
        commands::open_vault,
        commands::current_vault,
        commands::list_notes,
        commands::create_note,
        commands::read_note,
        commands::save_note,
    ])
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
