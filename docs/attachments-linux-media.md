# Attachments: Linux media playback (WebKitGTK)

Video, audio, and file-block attachments loaded via the Tauri asset protocol
(`convertFileSrc` → `asset://…`) **fail to display on Linux**, while working on
Windows and macOS. This is a long-standing upstream limitation, not a Tundra
bug.

## Why

Tauri uses a different webview per OS:

| OS      | Webview   | Media decode |
| ------- | --------- | ------------ |
| Windows | WebView2 (Chromium) | in the webview |
| macOS   | WebKit    | in the webview |
| Linux   | WebKitGTK | **GStreamer** |

On Linux, WebKitGTK delegates `<video>`/`<audio>` playback to **GStreamer**,
which has no handler for Tauri's custom `asset://` scheme. The media element
errors out (`NotSupportedError` / `MEDIA_ERR_SRC_NOT_SUPPORTED`) and shows
nothing after the user picks a file. `<img>` never touches GStreamer, so **image
blocks work on every platform** — the tell-tale signature of this issue.

Upstream references:
- tauri-apps/tauri#3725 — loading video/audio as an asset does not work
- tauri-apps/tauri#8654 — can't play local audio on Linux
- tauri-apps/tauri#4133 — streaming media without loading the whole file

## What we do

The fix lives entirely in the service layer (`src/services/index.ts`,
`attachments.resolveUrl`), which BlockNote's `resolveFileUrl` calls at render
time:

- **Images, and everything on Windows/macOS** → the streaming `asset://` URL,
  unchanged. No extra memory, no regression.
- **Linux, video/audio/file** → `fetch()` the bytes over `asset://` (unlike the
  GStreamer media backend, `fetch`/XHR *can* reach the scheme), then hand
  BlockNote a `blob:` URL that WebKit plays from memory. The blob's Content-Type
  is inherited from the asset protocol's response (correct, extension-based), so
  the media element gets the right MIME with no client-side guessing.

Blob URLs are cached by vault-relative path. Because attachments are
content-addressed (the path carries the content hash), identical content maps to
one blob reused across notes, and `resolveFileUrl` can fire on every render
without refetching or leaking a fresh object URL.

## Related: empty file-picker for the *file* block (Linux)

A separate WebKitGTK quirk affects **choosing** a file (not displaying it).
BlockNote's generic file block renders `<input type="file" accept="*/*">`
(`fileBlockAccept` defaults to `["*/*"]`). WebKitGTK turns `accept="*/*"` into a
GTK file-chooser MIME filter that matches nothing and offers no "All Files"
fallback, so the dialog appears empty — no PDFs, no anything. Image/video/audio
blocks use real `image/*`-style filters, which work; only the file block breaks,
and only on Linux.

Fix: `src/editor/webkitFileInputFix.ts` installs a one-time capture-phase click
listener (Linux only) that strips a bare `accept="*/*"` from a file input just
before its chooser opens, leaving the real media filters untouched. Installed
from `main.tsx`.

## Known limitation / follow-up

The blob holds the **whole file in memory** for its session lifetime. That's
fine for typical clips but not for very large video. True streaming playback on
Linux would require the heavyweight route — a custom **GStreamer plugin**
(`gstreamer-rs`) that teaches GStreamer the `asset://` scheme (see
<https://yanovskyy.com/blog/en/tauri-webkit>). Deferred until large-media
playback on Linux actually becomes a problem.
