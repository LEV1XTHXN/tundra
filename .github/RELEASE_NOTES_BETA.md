# Tundra 0.1.0-beta.1

First public beta. Local-first, Notion-style, Markdown-aware note taking —
everything stays on your machine. No account, no cloud, no telemetry.

> **These builds are not code-signed.** Every OS will warn you the first time you
> open them. The steps below are how you get past that. Only download these files
> from this Releases page.

## Downloads

| OS | File | Notes |
| --- | --- | --- |
| Linux (any distro) | `Tundra_0.1.0_amd64.AppImage` | Portable — **recommended** |
| Debian / Ubuntu | `Tundra_0.1.0_amd64.deb` | Ubuntu 22.04+ / Debian 12+ |
| Fedora / RHEL | `Tundra-0.1.0-1.x86_64.rpm` | |
| Windows 10/11 (x64) | `Tundra_0.1.0_x64-setup.exe` | Installs per-user, no admin needed |
| macOS Apple Silicon | `Tundra_0.1.0_aarch64.dmg` | M1 and newer |
| macOS Intel | `Tundra_0.1.0_x64.dmg` | macOS 10.15+ |

The filenames say `0.1.0`, not `0.1.0-beta.1` — installer versions have to stay
numeric (RPM reads `-` as the version/release separator). The release tag is the
beta marker.

## Install

### macOS — getting past Gatekeeper

The app is only ad-hoc signed, so macOS quarantines it on download.

1. Open the `.dmg` and drag **Tundra** into **Applications**.
2. In Applications, **right-click Tundra → Open**, then **Open** again in the
   dialog. Right-click → Open is required — a plain double-click gives you a
   dead-end dialog with no "Open anyway" button.

If macOS still says *"Tundra is damaged and can't be opened"*, strip the
quarantine flag and open it normally:

```sh
xattr -dr com.apple.quarantine /Applications/Tundra.app
```

### Windows — getting past SmartScreen

Run `Tundra_0.1.0_x64-setup.exe`. Windows shows *"Windows protected your PC"* —
click **More info**, then **Run anyway**. It installs for the current user only
and never asks for admin rights.

If Microsoft Edge blocks the download itself: in the Downloads list, click the
**…** next to the file → **Keep** → **Show more** → **Keep anyway**.

### Linux — AppImage

```sh
chmod +x Tundra_0.1.0_amd64.AppImage
./Tundra_0.1.0_amd64.AppImage
```

### Linux — .deb / .rpm

The packages need the **WebKit2GTK 4.1** runtime, which isn't installed by
default everywhere:

```sh
# Debian / Ubuntu
sudo apt install libwebkit2gtk-4.1-0
sudo dpkg -i Tundra_0.1.0_amd64.deb

# Fedora
sudo dnf install webkit2gtk4.1
sudo dnf install ./Tundra-0.1.0-1.x86_64.rpm
```

The RPM's declared dependencies use Fedora package names. On openSUSE the
runtime is `libwebkit2gtk-4_1-0` — install it first and use `rpm -i --nodeps`,
or just take the AppImage.

## First run

Tundra asks where your notes should live:

- **Use default vault** — creates `~/Documents/Tundra` (`Documents\Tundra` on
  Windows). If your system has no Documents folder, it uses `~/Tundra`.
- **Choose a folder…** — point it at any folder you like.

Everything Tundra writes lives inside that one folder: notes as plain JSON,
attachments, settings, and a rebuildable cache. Copy it, back it up, or drop it
in Syncthing/Dropbox — it's just files.

## Known limitations

- **Unsigned builds.** There's no Apple Developer ID and no Windows
  code-signing certificate behind this beta, hence the warnings above. Signed
  builds are planned.
- **Spellcheck is inert.** The engine ships, but no dictionary is bundled yet
  (an open licensing decision), so nothing is ever flagged as misspelled.
  Adding words to your personal dictionary works and is preserved.
- **No auto-update.** Updating means downloading the next release by hand. Your
  vault is untouched by reinstalling.
- **Linux video/audio attachments are loaded fully into memory.** WebKitGTK
  hands `<video>`/`<audio>` to GStreamer, which can't read Tauri's `asset://`
  scheme, so Tundra fetches the bytes and plays them from a `blob:` URL
  instead. Images are unaffected; large video files will use a lot of RAM for
  the session.
- **The webview runs without a Content-Security-Policy** in this build. It
  makes no network requests of any kind, so the exposure is small, but a policy
  is on the list for 0.2.
- **x86-64 only.** No Linux ARM or Windows ARM builds yet.

## Feedback

It's a beta — please back up anything important (Settings → Backup vault) and
report what breaks: <https://github.com/LEV1XTHXN/tundra/issues>

Useful details for a bug report: your OS and version, which download you used,
and whether it happened on a fresh vault.
