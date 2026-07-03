# File watcher (`watcher`)

The Rust file watcher (`crates/tundra-core/src/watcher.rs`) watches a vault's
`notes/` tree and reports **genuine external changes** to the frontend, so an
edit made outside the app (another editor, a sync tool later) reconciles into the
open note. It must **not** react to the app's own file activity — that's what the
self-write registry (`Vault::consume_self_write`) and the filtering below are for.

## Gotcha: `notify` reports file *reads*, and reacting to them = infinite reload loop

**Symptom:** open a note and it reloads ~once per second — a brief "Loading…"
flashes and the note re-renders, forever, with no user input.

**Cause:** on Linux, `notify` (inotify backend) emits `EventKind::Access(Open(..))`
events whenever a file is merely **opened/read** — including the app's *own* reads.
The self-write registry only records **writes**, so a read is never recognized as
"ours". `reconcile_path` treated any `.json` event as a change and emitted
`NoteChangedExternally`. That drove this self-sustaining loop:

```
editor opens note → read_note() opens the file → OS emits Access(Open)
   → watcher: "changed externally" (not a self-write) → emit NoteChangedExternally
   → editor reloads the note → read_note() opens the file again → Access(Open) → …
```

Each lap is one debounce round-trip (~600 ms editor + ~400 ms watcher ≈ 1 s), which
is the once-a-second flash.

**Fix:** the watcher drops `EventKind::Access(_)` events at the source (before they
even reach the debounce). An open/read never changes a file; a real change always
arrives as `Create` / `Modify` / `Remove`, so external-edit detection is unaffected.

**Why the tests didn't catch it:** the original watcher tests only exercised
*writes* (which the self-write registry correctly filters). A pure *read* was never
tested. Regression test added: `watcher_does_not_report_a_pure_read`.

## Rules of thumb when touching the watcher

- Only `Create` / `Modify` / `Remove` represent real changes. Never treat an
  `Access(_)` event as a change — the app reads its own note files constantly
  (every `read_note`, every reindex).
- The app's own **writes** are atomic (temp file + rename); the final write is
  recorded via `record_self_write` and filtered by `consume_self_write`. Keep any
  new write path going through that so it stays self-filtered.
- If you add debouncing/coalescing, remember paths are collapsed into a `HashSet`,
  so multiple raw events for one save become one path — consumed once.

See also [`vault-and-state.md`](vault-and-state.md) for the vault layout and the
self-write registry's role.
