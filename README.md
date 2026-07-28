<img src="public/bison-logo.svg" alt="" width="72" align="left" hspace="12">

# Tundra

**A local-first, Notion-style, Markdown-aware note app for the desktop.**
Your notes are typed blocks stored as plain JSON in a folder you choose — no
account, no cloud, no telemetry.

<br clear="left">

> **Status: public beta (`0.1.0-beta.1`).** The builds are unsigned and there is
> no auto-update yet. See the [latest release][releases] for downloads and the
> per-OS install steps.

## Features

- **Block editor** — Notion-style blocks with Markdown input shortcuts, tables,
  image/video/file embeds, per-note icons and cover banners.
- **A real vault** — folders are real directories; notes are one JSON file each,
  identified by a UUID so links survive moves and renames.
- **Links & graph** — `[[wikilinks]]`, backlinks, and a WebGL graph view of how
  everything connects.
- **Search** — full-text search over the whole vault plus `#tag` search, from a
  command palette.
- **Calendar** — month and week views, repeating events, and notes linked to
  dates.
- **Kanban** — boards backed by note tags, with column↔tag drag automation.
- **Organise** — tags with colours, folder groups and icons, per-folder sorting,
  folder "database" table views with your own columns, note templates, quick
  notes, and a home dashboard of widgets.
- **Import** — bring notes in from Obsidian, Notion or Anytype.
- **Backup** — snapshot the entire vault to an archive stored outside it.
- **Yours to configure** — rebindable keyboard shortcuts, themes, and UI
  languages (English, Russian, German).

## Download

Grab an installer from the [Releases page][releases]:

| OS | File |
| --- | --- |
| Linux (any distro) | `.AppImage` — portable, recommended |
| Debian / Ubuntu | `.deb` |
| Fedora / RHEL | `.rpm` |
| Windows 10/11 (x64) | `-setup.exe` (per-user, no admin) |
| macOS (Apple Silicon / Intel) | `.dmg` |

The beta builds are **not code-signed**, so macOS and Windows will warn you on
first launch. The release notes walk through both — on macOS it's right-click →
Open, on Windows it's More info → Run anyway.

## Your data

Everything lives in the vault folder you pick on first run. Notes are readable
JSON, attachments are ordinary files, and the derived search/graph caches live
under `.vault/cache/` and can be deleted at any time — they rebuild themselves.
Copy the folder, back it up, or sync it however you like; Tundra never phones
home.

## Build from source

Prerequisites per OS are in [`docs/dev-setup.md`](docs/dev-setup.md) (Rust +
Node, and the WebKitGTK dev packages on Linux).

```sh
npm ci
npm run tauri dev      # run in development
npm run tauri build    # produce installers for the current OS
```

Cutting a release is documented in [`docs/release.md`](docs/release.md).

## Architecture

Tundra keeps a strict boundary: **all** data logic lives in a Rust core, and
React only renders. `CLAUDE.md` is the product spec and the locked architecture
decisions; [`docs/`](docs/README.md) holds the practical implementation notes.

```
React + TypeScript  →  service layer  →  Tauri IPC  →  Rust core  →  file system
```

## License

MIT — see [`LICENSE`](LICENSE).

[releases]: https://github.com/LEV1XTHXN/tundra/releases
