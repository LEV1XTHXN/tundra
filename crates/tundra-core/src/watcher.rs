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
mod tests {
    use std::fs;
    use std::sync::mpsc::channel;
    use std::time::Duration;

    use super::*;
    use crate::document::Note;

    fn temp_vault() -> (Vault, PathBuf) {
        let dir = std::env::temp_dir().join(format!("tundra-watcher-test-{}", uuid::Uuid::new_v4()));
        (Vault::open(&dir).unwrap(), dir)
    }

    /// Drain the channel until either the wanted event shows up or the
    /// deadline passes. Every real app (and this test) starts the watcher
    /// before doing anything else, so a self-triggered write's own notify
    /// event gets consumed by the watcher as it's processed — draining here
    /// mimics that instead of leaving a stale self-write entry unconsumed.
    fn wait_for(rx: &std::sync::mpsc::Receiver<ChangeEvent>, wanted: &ChangeEvent, timeout: Duration) -> bool {
        let deadline = std::time::Instant::now() + timeout;
        while std::time::Instant::now() < deadline {
            if let Ok(ev) = rx.recv_timeout(Duration::from_millis(200)) {
                if &ev == wanted {
                    return true;
                }
            }
        }
        false
    }

    /// End-to-end: a real `notify` watcher, on a real background thread,
    /// picking up a genuine external file change and reconciling it —
    /// exercises the actual OS file-watching API, not just `reconcile_path`
    /// in isolation.
    #[test]
    fn watcher_reports_a_genuine_external_change() {
        let (vault, dir) = temp_vault();

        let (tx, rx) = channel::<ChangeEvent>();
        let _watcher = Watcher::watch(vault.clone(), move |event| {
            let _ = tx.send(event);
        })
        .unwrap();
        // Give the watcher a moment to actually start observing before we
        // make any change (avoids a flaky "happened before the OS handle was
        // registered" race).
        std::thread::sleep(Duration::from_millis(200));

        // Created through the app, with the watcher already running: its own
        // write is filtered, exactly as it would be in the real app.
        let note = vault.create_note("Lichen").unwrap();
        assert!(
            !wait_for(&rx, &ChangeEvent::NoteChangedExternally { id: note.id.clone() }, Duration::from_secs(1)),
            "the app's own create must not be reported as an external change"
        );

        let path = dir.join("notes/lichen.json");
        let mut on_disk: Note = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        on_disk.title = "Lichen (edited externally)".to_string();
        fs::write(&path, serde_json::to_vec_pretty(&on_disk).unwrap()).unwrap();

        assert!(
            wait_for(&rx, &ChangeEvent::NoteChangedExternally { id: note.id.clone() }, Duration::from_secs(5)),
            "expected a NoteChangedExternally event for the edited note"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Merely *reading* a note file must never be reported as a change. The OS
    /// emits open/access events for our own reads too (every `read_note` when
    /// the editor loads a note), and reacting to them created an endless
    /// open→"changed externally"→reload→read loop. A read is not a write, so no
    /// event should reach the frontend.
    #[test]
    fn watcher_does_not_report_a_pure_read() {
        let (vault, dir) = temp_vault();

        let (tx, rx) = channel::<ChangeEvent>();
        let _watcher = Watcher::watch(vault.clone(), move |event| {
            let _ = tx.send(event);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(200));

        let note = vault.create_note("Sedge").unwrap();
        let path = dir.join("notes/sedge.json");

        // Open/read the file repeatedly, exactly as the editor does when it
        // (re)loads a note — no writes, so nothing genuinely changed.
        for _ in 0..5 {
            let _ = fs::read(&path).unwrap();
            std::thread::sleep(Duration::from_millis(50));
        }

        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while std::time::Instant::now() < deadline {
            if let Ok(ChangeEvent::NoteChangedExternally { id }) = rx.recv_timeout(Duration::from_millis(200)) {
                assert_ne!(id, note.id, "reading a note must not be reported as an external change");
            }
        }

        std::fs::remove_dir_all(&dir).ok();
    }

    /// The vault's own write must never be reported as an external change —
    /// this is the whole point of the self-write registry (step 2).
    #[test]
    fn watcher_does_not_report_the_vaults_own_write() {
        let (vault, dir) = temp_vault();

        let (tx, rx) = channel::<ChangeEvent>();
        let _watcher = Watcher::watch(vault.clone(), move |event| {
            let _ = tx.send(event);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(200));

        let note = vault.create_note("Moss").unwrap();
        let mut edited = note.clone();
        edited.title = "Moss (saved by the app itself)".to_string();
        vault.save_note(edited).unwrap();

        // No event should arrive for either the create or the save above.
        // Wait out a window comfortably longer than the debounce; any event
        // that shows up for this note id is the bug.
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while std::time::Instant::now() < deadline {
            if let Ok(ChangeEvent::NoteChangedExternally { id }) = rx.recv_timeout(Duration::from_millis(200)) {
                assert_ne!(id, note.id, "the app's own save must not be reported as an external change");
            }
        }

        std::fs::remove_dir_all(&dir).ok();
    }
}
