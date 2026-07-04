# Keybindings, find-in-note & settings

How the app's keyboard shortcuts are defined, matched, persisted, and rebound —
and how the browser-style "find in note" is implemented on top of BlockNote's
ProseMirror view.

## The keybinding system

There is exactly **one** source of truth for shortcuts. Adding one = add a
`CommandDef` to the registry and handle its id where the action lives. Nothing
else in the app hardcodes a key combo.

- **`src/keybindings/registry.ts`** — `COMMANDS`: every rebindable command with
  its `CommandId`, label, description, category, and `defaultBinding`.
  `CommandId`s are persisted (they key the overrides map) — **treat as
  append-only**; renaming one silently drops a user's saved binding.
- **`src/keybindings/binding.ts`** — canonical binding strings and the matcher.
  - A binding is `+`-joined, modifiers first in fixed order `Ctrl+Alt+Shift+Meta`,
    then the key, e.g. `"Ctrl+Shift+K"`, `"Alt+I"`, `"F2"`.
  - The key token comes from `KeyboardEvent.code` (physical key), **not `.key`**,
    so bindings are layout-independent and don't shift when Alt/Shift change the
    produced character (Alt+I stays `"Alt+I"` everywhere).
  - `matchCommand(e, bindings)` has a **typing guard**: a binding with no hard
    modifier (Ctrl/Alt/Meta) and no function key is ignored while a text field or
    the editor is focused, so a bare-key rebind can't break typing.
- **`src/store/keybindings.ts`** — zustand store holding the merged map
  (defaults overlaid with overrides). Only the **overrides** (bindings differing
  from a default) are persisted, so changing a default later still reaches users
  who never rebound it. `findConflicts()` flags combos mapped to two commands.

### Dispatch is split by scope (two listeners, one matcher)

- **`src/App.tsx`** handles the *global* commands — `search.global` (F2),
  `inspector.toggle` (Alt+I), `note.new` (Ctrl+Alt+N).
- **`src/editor/NoteEditor.tsx`** handles the *editor-scoped* commands —
  `search.inNote` (Ctrl+F) and `link.create` (Ctrl+Shift+K).

Both are plain `window` keydown listeners using the same `matchCommand`; each acts
only on its own command ids and `preventDefault`s only when it acts, so there's no
double handling. This mirrors the pre-existing two-listener layout.

### Defaults & the notable choices

| Command | Default | Note |
| --- | --- | --- |
| `search.global` | `F2` | Replaced the old Ctrl+K, which is now free for BlockNote's in-editor web-link shortcut. |
| `search.inNote` | `Ctrl+F` | Find-in-note (below). |
| `inspector.toggle` | `Alt+I` | Alt+I, **not** Ctrl+I — Ctrl+I is BlockNote's italic. |
| `note.new` | `Ctrl+Alt+N` | Ctrl+N is reserved by the webview for a new window. |
| `link.create` | `Ctrl+Shift+K` | Unchanged from before. |

## Persistence (app-scoped, Rust-owned)

Keybindings are **global preferences**, not vault content, so they live in the OS
app-config dir, not the vault and not `localStorage` (CLAUDE.md §5.1 / §4).

- Rust: `read_app_settings(name)` / `write_app_settings(name, json)` in
  `src-tauri/src/commands.rs` (registered in `lib.rs`). Each named blob is stored
  at `{app_config_dir}/settings/<name>.json`, written atomically (temp + rename).
  `name` is restricted to a bare identifier to prevent path traversal.
- TS gateway: `appSettings.read<T>(name)` / `appSettings.write(name, value)` in
  `src/services/index.ts` (mirrors the vault-scoped `config`).
- Overrides persist under name `"keybindings"`. A corrupt file is treated as
  absent (fall back to defaults) — preferences are always recoverable.

These commands are generic; future settings sections reuse them with a different
`name`.

## Settings UI

**`src/settings/SettingsDialog.tsx`** — shadcn `Dialog`, a left rail of sections
(only **Keybindings** today; structured so Appearance/Backup/etc. slot in) and the
keybindings pane. Each row: label + description, a **Record** button that captures
the next combo (capture-phase listener + `stopPropagation`, so it never leaks to
the global dispatcher; Esc cancels), a per-row **Reset**, and an inline conflict
warning. Footer has **Reset all**. Opened from the sidebar's **Settings** button.

## Find in note (`Ctrl+F`)

Browser-style find over the open note, built on BlockNote's ProseMirror view.

- **`src/editor/findPlugin.ts`** — a ProseMirror plugin (own `PluginKey`) holding
  a `DecorationSet`. `findMatches()` walks the doc's text nodes for
  case-insensitive matches (within a single text node — matches spanning mark
  boundaries aren't merged, which is fine for note find). Highlights use classes
  `find-match` / `find-match-active`.
  - **Attached at runtime** by reconfiguring the live view:
    `view.updateState(view.state.reconfigure({ plugins: [...concat(plugin)] }))`.
    This keeps find decoupled from BlockNote's extension API. Idempotent; the
    returned detach fn removes the plugin and clears highlights.
  - Query/active index are pushed in via transaction meta; `focusMatch()` also
    moves the editor **selection** onto the active match and `scrollIntoView()`s
    it — so the current match is visible even if a webview doesn't paint the
    decoration (WebKitGTK safety net).
- **`src/editor/FindBar.tsx`** — the input + count + prev/next + close, pinned
  `position: sticky` top-right of the scrolling `.editor-pane`. Enter = next,
  Shift+Enter = prev, Esc = close (clears highlights on unmount).

## Gotchas

- Match highlight colors are fixed amber tones because the editor is force-themed
  light (`.editor-pane .bn-root`), independent of the shell's light/dark mode.
- `editor.prosemirrorView` is only valid once `BlockNoteView` has mounted; the
  find bar renders inside `NoteEditor` where that's already true.
- If BlockNote ever reconfigures its view and drops appended plugins, the find
  highlight would disappear; re-attaching happens each time the bar opens.
