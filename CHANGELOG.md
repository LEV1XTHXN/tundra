# Changelog

All notable changes to Tundra are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer](https://semver.org/spec/v2.0.0.html) — note that installer
versions stay numeric (`0.1.0`) because RPM reads `-` as the version/release
separator; the prerelease marker lives in the git tag.

## [Unreleased]

## [0.1.0-beta.1] — 2026-07-28

First public beta. Covers Phases 0–3 of the roadmap in `CLAUDE.md`.

### Added

- **Editor** — BlockNote block editor with Markdown input shortcuts, tables,
  image/video/file embeds, per-note emoji and custom icons, and cover banners.
- **Vault** — user-chosen vault folder (or one-click default under Documents),
  real directories for folders, one JSON file per note with a stable UUID, and
  external-change detection via a file watcher.
- **Links & graph** — `[[wikilinks]]`, backlinks, and a sigma/graphology WebGL
  graph view with persisted view settings.
- **Search** — Tantivy full-text search and `#tag` search from the command
  palette, plus find-in-note.
- **Calendar** — month and week views, repeating events, and note↔date links.
- **Kanban** — boards backed by note tags, with column↔tag drag automation.
- **Organisation** — coloured tags, folder groups with per-folder icons,
  per-folder sorting and pinning, folder "database" table views with
  user-defined columns, note templates, quick notes, and a home dashboard with
  user-selectable widgets.
- **Import** — Obsidian, Notion and Anytype vault import.
- **Backup** — one-click whole-vault archive written outside the vault, plus an
  orphaned-attachment sweep.
- **Customisation** — rebindable keyboard shortcuts, theming, an optional
  dyslexia-friendly font, and UI languages `en` / `ru` / `de` (`ru` and `de`
  are machine-drafted and need a native pass).
- **Packaging** — GitHub Actions release matrix producing Linux
  AppImage/deb/rpm, a Windows NSIS installer, and macOS DMGs for Apple Silicon
  and Intel.

### Fixed

- `default_vault_path` now falls back to the home directory when the OS reports
  no Documents folder, so one-click onboarding works on Linux systems without
  XDG user-dirs configured.

### Known limitations

- macOS and Windows builds are unsigned (macOS is ad-hoc signed only).
- The spellcheck engine ships without dictionaries and is therefore inert; a
  licensing decision on which dictionary to vendor is still open.
- No auto-update.
- On Linux, video/audio attachments are loaded fully into memory — WebKitGTK
  hands playback to GStreamer, which cannot read Tauri's `asset://` scheme.
  See [`docs/attachments-linux-media.md`](docs/attachments-linux-media.md).
- The webview runs without a Content-Security-Policy; see
  [`docs/release.md`](docs/release.md) for the candidate policy queued for 0.2.
- x86-64 only — no Linux ARM or Windows ARM builds.

[Unreleased]: https://github.com/LEV1XTHXN/tundra/compare/v0.1.0-beta.1...HEAD
[0.1.0-beta.1]: https://github.com/LEV1XTHXN/tundra/releases/tag/v0.1.0-beta.1
