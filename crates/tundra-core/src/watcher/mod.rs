//! File watching (CLAUDE.md §6.1 `sync`-adjacent, Phase 1 step 8): watches a
//! vault's `notes/` tree with `notify`, debounces the raw events, filters out
//! the vault's own writes (the self-write registry from step 2), and
//! reconciles genuine external changes against the in-memory index.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::time::Duration;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher as NotifyWatcher};

use crate::vault::{ChangeEvent, Vault};

/// How long to wait for more events after the first one in a batch, before
/// processing — coalesces the several raw events a single save (or an
/// external editor's own atomic save) tends to produce.
const DEBOUNCE: Duration = Duration::from_millis(400);

/// An active file watcher for one vault. Dropping it stops watching (the
/// background thread exits once the underlying `notify` watcher, and the
/// channel sender it owns, are dropped).
pub struct Watcher {
    _inner: RecommendedWatcher,
}

impl Watcher {
    /// Start watching `vault`'s `notes/` tree. Calls `on_event` for every
    /// distinct, debounced, self-write-filtered external change, from a
    /// dedicated background thread.
    pub fn watch(
        vault: Vault,
        mut on_event: impl FnMut(ChangeEvent) + Send + 'static,
    ) -> notify::Result<Self> {
        let (tx, rx) = channel::<notify::Event>();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res {
                // Ignore pure access events (file opened/read/closed-without-write).
                // These do NOT change a file, yet the OS emits them for our own
                // reads too — e.g. every `read_note` when the editor (re)loads a
                // note. Reacting to them turned an ordinary open into an endless
                // reload loop: read -> IN_OPEN event -> "changed externally" ->
                // reload -> read -> … A genuine change always arrives as a
                // Create / Modify / Remove event, so dropping Access here is safe
                // and never resets the debounce window below on a mere read.
                if matches!(event.kind, EventKind::Access(_)) {
                    return;
                }
                let _ = tx.send(event);
            }
        })?;
        watcher.watch(&vault.notes_dir(), RecursiveMode::Recursive)?;

        std::thread::spawn(move || loop {
            let first = match rx.recv() {
                Ok(e) => e,
                Err(_) => return, // the Watcher (and its channel) was dropped
            };
            let mut paths: HashSet<PathBuf> = first.paths.into_iter().collect();

            // Coalesce whatever else arrives within the debounce window.
            loop {
                match rx.recv_timeout(DEBOUNCE) {
                    Ok(e) => paths.extend(e.paths),
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }

            for path in paths {
                // Never react to the vault's own writes (step 2's self-write
                // registry) — this is what stops a save from triggering a
                // reload loop.
                if vault.consume_self_write(&path).is_some() {
                    continue;
                }
                for event in vault.reconcile_path(&path) {
                    on_event(event);
                }
            }
        });

        Ok(Watcher { _inner: watcher })
    }
}


#[cfg(test)]
mod tests;
