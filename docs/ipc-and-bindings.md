# IPC & typed bindings (`ipc` / `services`)

The Rust↔TypeScript boundary is typed end-to-end. Rust command signatures are the
source of truth; the matching TS types are **generated**, so the frontend can't
drift from the core (CLAUDE.md §8.2).

## The pieces

- **Rust side** (`src-tauri/src/commands.rs`): each command is annotated with both
  `#[tauri::command]` and `#[specta::specta]`. They hold no logic — they resolve the
  open vault from managed state and delegate to `tundra-core`.
- **The builder** (`src-tauri/src/lib.rs`, `specta_builder()`): the single list of
  commands, used by both `run()` and the export test.
- **TS side** (`src/services/bindings.ts`): generated. `src/services/index.ts` wraps
  it, unwrapping the `Result` into a value or a thrown typed `CoreError`. **`services/`
  is the only module allowed to import `@tauri-apps/api`.**

## Regenerating `bindings.ts`

It regenerates automatically on `npm run tauri dev` (debug builds call `.export()`).
To regenerate without launching the GUI (CI, headless):

```
cargo test -p tundra export_bindings
```

`bindings.ts` **is committed** to the repo (the ignore rule for it in `.gitignore`
is intentionally left commented). Convention: if you change a command signature or
any `tundra-core` type that crosses IPC, **regenerate and commit `bindings.ts` in the
same change** so both developers stay in sync.

## Version pinning (don't loosen casually)

`specta`, `tauri-specta`, and `specta-typescript` are pre-1.0 and their APIs move
between release candidates. They are pinned exactly:

- `specta = "=2.0.0-rc.25"`, `tauri-specta = "=2.0.0-rc.25"` (rc versions must match)
- `specta-typescript = "0.0.12"`

Bumping one usually means bumping all three together and re-checking the export.

## Gotcha: `serde_json::Value` and BigInt-forbidden

`specta-typescript` refuses to export `i64`/`u64`/`usize`/… to avoid `JSON.parse`
precision loss. `serde_json::Value`'s number variant contains `i64`/`u64`, so any
field typed as `serde_json::Value` fails export with a `BigIntForbidden` error.

Block `props`/`content` are arbitrary JSON (BlockNote owns the block schema), so in
`crates/tundra-core/src/document.rs` they're annotated:

```rust
#[specta(type = Option<specta_typescript::Any>)]
pub props: Option<serde_json::Value>,
```

This exports them as TS `any` — correct here, since the frontend types come from
BlockNote, not from us. **Don't remove that annotation** or the bindings export
breaks. This is also why `tundra-core` depends on `specta-typescript`.
