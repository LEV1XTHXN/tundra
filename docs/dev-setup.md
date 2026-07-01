# Development setup

Tundra is Tauri v2 + React/TS + a Rust workspace. Committed config files are
cross-platform — you should **not** need to edit them per machine. What differs per
developer is the toolchain and OS prerequisites you install locally (none of which
live in the repo).

## All platforms

- **Rust** via [rustup](https://rustup.rs) (stable).
- **Node** LTS (any install method — installer, nvm, fnm, volta).
- Then:
  ```
  npm install
  npm run tauri dev      # build + run the desktop app
  ```

## OS-specific prerequisites (the analog of each other)

**Linux (Fedora / dnf):**
```
sudo dnf install -y webkit2gtk4.1-devel gtk3-devel libsoup3-devel \
  librsvg2-devel libappindicator-gtk3-devel openssl-devel curl wget file
```
(Debian/Ubuntu: the `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libsoup-3.0-dev`,
`librsvg2-dev`, `libayatana-appindicator3-dev`, `build-essential` equivalents.)

**Windows:**
- **Microsoft C++ Build Tools** (Visual Studio Build Tools → "Desktop development
  with C++") — provides the MSVC linker Rust needs.
- **WebView2 runtime** — preinstalled on Windows 11 and recent Windows 10; otherwise
  install the Evergreen runtime from Microsoft.
- No `webkit2gtk` — that's Linux-only; cargo pulls the Windows WebView2 backend
  automatically via `cfg()`.

**macOS:**
- Xcode Command Line Tools: `xcode-select --install`.

## Notes

- `Cargo.lock` and `package-lock.json` are committed (this is a shipped app —
  reproducible builds matter). Platform-specific binaries (esbuild, wry backends)
  resolve automatically at install/build time.
- `bindings.ts` is generated but committed — see [`ipc-and-bindings.md`](ipc-and-bindings.md).
- **Recommended (not yet added):** a `.gitattributes` normalizing line endings to LF
  so Windows/Linux checkouts don't produce whitespace-only diff churn.
