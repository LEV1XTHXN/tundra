# Cutting a release

How a Tundra release is built and published. Builds for all three desktop
platforms come out of a GitHub Actions matrix — macOS bundles can't be produced
on Linux at all, and cross-compiling Windows from Linux yields no MSI and
routinely breaks on WebView2, so each OS builds on its own native runner.

## The two workflows

- **`.github/workflows/ci.yml`** — cheap Linux-only gate on every push/PR:
  typecheck, layering lint, vitest, `cargo test`, and a bindings-drift check.
  It exists so a red release run (four cold Rust builds) is never the first
  signal that something is broken.
- **`.github/workflows/release.yml`** — triggered by pushing a `v*` tag (or
  `workflow_dispatch` with an existing tag). Job 1 creates a **draft
  prerelease** whose body is `.github/RELEASE_NOTES_BETA.md` verbatim; job 2 is
  a four-way matrix (`ubuntu-22.04`, `windows-latest`, and `macos-15` twice —
  once native arm64, once cross-compiled to Intel) that uploads into that
  release by id.

  The two-job split matters: if every matrix leg let `tauri-action`
  find-or-create the release itself, they race and you get duplicate drafts
  with the assets split between them.

## Version touchpoints

Three manifests carry the version and must agree:

1. `Cargo.toml` → `[workspace.package] version` (both crates inherit it)
2. `package.json` → `version`
3. `src-tauri/tauri.conf.json` → `version`

Then regenerate the lockfiles and write the changelog entry:

4. `Cargo.lock` — `cargo check --workspace`
5. `package-lock.json` — `npm install --package-lock-only`
6. `CHANGELOG.md` — new section, and update the compare/tag links at the bottom

**Keep the manifest version numeric.** RPM reads `-` as the version/release
separator, so a `version` of `0.1.0-beta.1` makes the RPM bundle fail to build.
Prerelease markers live in the git tag and release name only; the release notes
explain the discrepancy to users.

## Pre-tag checklist

Run all of it locally, in this order:

```sh
git status --porcelain                          # must be empty
npm ci                                          # not `npm install` — this is what CI runs
npx tsc --noEmit
npm run check:layering
npm test
cargo test --workspace
git diff --exit-code src/services/bindings.ts   # cargo test rewrites this; commit if dirty
npm run tauri build
```

`npm run tauri build` locally is **not optional**. Tauri v2's config
deserializer rejects unknown keys, so one typo in `tauri.conf.json`
(`licenceFile`, `macos` instead of `macOS`) fails all four runners identically,
minutes into the run. One local build catches every config error for free.

Bundles land in the **workspace root** `target/release/bundle/{deb,rpm,appimage}/`
— not `src-tauri/target/`, because the Cargo workspace is rooted at the repo
root.

> **Fedora hosts: the AppImage step fails unless you set `NO_STRIP`.**
> ```sh
> NO_STRIP=true npm run tauri build
> ```
> `linuxdeploy` ships its own ancient `strip`, which can't parse the
> `.relr.dyn` (`SHT_RELR`) sections in modern Fedora system libraries and dies
> with `unknown type [0x13] section '.relr.dyn'` on every bundled `.so`. Only
> the local Fedora build is affected — CI builds the AppImage on
> `ubuntu-22.04`, whose libraries don't use RELR — so **don't** put `NO_STRIP`
> in the workflow. The deb and rpm bundles are unaffected either way.

### First-run test on a fresh profile

This is the real "works out of the box" gate. Per-OS app config directories:

| OS | Path |
| --- | --- |
| Linux | `~/.config/com.tundra.app/` |
| macOS | `~/Library/Application Support/com.tundra.app/` |
| Windows | `%APPDATA%\com.tundra.app\` |

On Linux you can fake a pristine machine without touching your own profile:

```sh
mkdir -p /tmp/tundra-fresh
env HOME=/tmp/tundra-fresh ./target/release/bundle/appimage/Tundra_*.AppImage
```

Check, in order:

1. Onboarding renders instead of crashing (no `state.json` yet).
2. The bison logo appears — the canary for the whole `public/` asset pipeline.
3. **"Use default vault" succeeds.** A pristine `HOME` has no XDG user-dirs, so
   this exercises the `document_dir()` → `home_dir()` fallback in
   `src-tauri/src/commands/vault.rs`.
4. The vault opens fully: Tantivy index creation, link/calendar/kanban stores,
   and the inotify watcher all run inside `open_vault`.
5. The emoji picker shows emoji (`/emojibase/en/data.json`, ~768 KB from
   `public/`) and Twemoji glyphs render.
6. Inter and OpenDyslexic load (toggle the dyslexic font in Settings).
7. Relaunch with `LANG=ru_RU.UTF-8` — the UI translates, i.e. the lazily
   imported locale chunk resolved.
8. Import an image **and** a PDF or video — the `asset://` and Linux `blob:`
   paths are different code (`src/services/index.ts`).
9. Settings lists zero spellcheck languages, but adding a personal word still
   succeeds.
10. Backup writes an archive outside the vault.
11. A second launch skips onboarding (`state.json` now has `lastVault`).

Repeat the same checklist against the Windows and macOS artifacts before
publishing the draft — including checking that the Gatekeeper/SmartScreen
wording in the release notes matches what actually appears on screen.

## Publishing

```sh
git push origin main                                   # push the commit FIRST
git tag -a v0.1.0-beta.1 -m "Tundra 0.1.0-beta.1"
git push origin v0.1.0-beta.1
```

Order matters: tagging a commit that hasn't been pushed means the workflow file
doesn't exist on the tag and nothing runs.

Then watch <https://github.com/LEV1XTHXN/tundra/actions>. Expect **20–40
minutes** for four cold Rust builds — tantivy and `zstd-sys` are the long poles.
Later runs are much faster thanks to `Swatinem/rust-cache`.

The draft should end up with six assets:

```
Tundra_<v>_amd64.deb
Tundra-<v>-1.x86_64.rpm
Tundra_<v>_amd64.AppImage
Tundra_<v>_x64-setup.exe
Tundra_<v>_aarch64.dmg
Tundra_<v>_x64.dmg
```

Test each, then publish with **"Set as a pre-release" checked** and "Set as the
latest release" unchecked while Tundra is in beta.

## Signing

There is deliberately **no signing configuration and no updater** in these
workflows. macOS uses `"signingIdentity": "-"` (ad-hoc) purely so the `.app`
launches at all on Apple Silicon; it does not satisfy Gatekeeper, which is why
the release notes carry the right-click → Open and `xattr -dr
com.apple.quarantine` instructions. Windows is unsigned and trips SmartScreen.

Real signing needs an Apple Developer ID ($99/yr) and a Windows code-signing
certificate; when those exist, add the `APPLE_*` and Windows certificate secrets
to `release.yml` — no other structural change is required.

## Known gotchas

- **`workflow_dispatch` re-runs** hit a 422 "already_exists" from
  `createRelease` if the draft is still there. Delete the draft first.
- **AppImage bundling downloads `linuxdeploy` at build time** — a network flake
  fails only the Linux leg. Re-run the job.
- **If the `ubuntu-22.04` runner label is retired**, switch to `ubuntu-24.04`.
  The apt list already avoids `libwebkit2gtk-4.0-dev` (which doesn't exist
  there), so it's a one-word change — but the glibc floor rises 2.35 → 2.39, so
  update the deb/AppImage compatibility line in the release notes.
- **macOS runner labels rot fast.** GitHub supports only the latest two macOS
  versions and retires the rest — `macos-13` (the last *free Intel* image) went
  away in December 2025, and `macos-14` was deprecated soon after. A retired
  label doesn't fail loudly: the job just sits on "waiting for a runner to pick
  up this job" until GitHub cancels it ~24h later. That's why both macOS legs
  now run on one Apple Silicon label with the Intel DMG cross-compiled — there
  is only one label to bump when 15 ages out. Check the current labels at
  <https://github.com/actions/runner-images> before a release if it's been a
  while.

## Deferred: the webview CSP

`app.security.csp` is `null`, so release builds run without a
Content-Security-Policy. This is a deliberate beta call, not an oversight: the
app makes zero network requests, while a *wrong* policy produces a blank window
**in the release build only** — unreproducible in `tauri dev`, which uses a
different origin and injection path. Tauri also auto-injects nonces when `csp`
is non-null, and a nonce makes browsers ignore `'unsafe-inline'`, which is a
trap worth discovering on purpose rather than during a release.

Candidate policy to test for 0.2 — it has to cover Tailwind v4 + shadcn +
BlockNote runtime `<style>` injection, the ForceAtlas2 web worker, and the
`asset:`/`blob:`/`data:` attachment paths:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' asset: http://asset.localhost blob: data:;
media-src 'self' asset: http://asset.localhost blob:;
font-src 'self' data:; worker-src 'self' blob:;
connect-src 'self' ipc: http://ipc.localhost asset: http://asset.localhost blob:;
object-src 'none'; frame-src 'none'
```
