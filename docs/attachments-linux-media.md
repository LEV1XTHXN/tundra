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

## A missing audio sink kills the whole web process

**This is the most important thing on this page.** WebKitGTK does not degrade
gracefully when GStreamer can't play something — for one specific failure it
aborts the entire web process.

When a media element starts loading, WebKit constructs a
`MediaPlayerPrivateGStreamer`, whose constructor calls `createAudioSink()`,
which ends in:

```
RELEASE_ASSERT(audioSink)   // MediaPlayerPrivateGStreamer.cpp:1592 (WebKitGTK 2.52)
```

If GStreamer cannot produce an audio sink — no `autoaudiosink`, no `pulsesink`,
a broken audio stack, or a package that ships GStreamer's core libs without its
plugins — that assert fires and the process takes `SIGABRT`. The observed stack:

```
abort
WTFCrashWithInfo(int, char const*, char const*, int)
WebCore::MediaPlayerPrivateGStreamer::createAudioSink()
WebCore::MediaPlayerPrivateGStreamer::MediaPlayerPrivateGStreamer(MediaPlayer&)
WebCore::MediaPlayerFactoryGStreamer::createMediaEnginePlayer(MediaPlayer&)
WebCore::MediaPlayer::loadWithNextMediaEngine(...)
WebCore::MediaPlayer::load(...)
WebCore::HTMLMediaElement::loadResource(...)
```

Consequences that are easy to get wrong:

- **It is not catchable.** It's a process-level abort, not a JS exception. No
  error boundary, `try`/`catch`, or `onerror` handler sees it; the window dies.
- **`preload="none"` does not help.** The player is built during
  `MediaPlayer::load()`, before any buffering decision.
- **Opening a note is enough.** No user interaction with the media is required.

### What we do about it

1. **`src/editor/mediaBlockSpecs.tsx`** replaces BlockNote's `video` and `audio`
   blocks with click-to-play versions. Until the user clicks, the block renders a
   static facade — no media element, and no `resolveFileUrl` call either. Wired
   into both `src/editor/schema.ts` and `src/quicknotes/quickNoteSchema.ts`.
   Block props, parsing and export are BlockNote's own, so note JSON is
   unaffected.
2. **`bundle.linux.appimage.bundleMediaFramework: true`** in
   `src-tauri/tauri.conf.json`. Without it the AppImage bundles
   `libgstreamer-1.0.so.0` (WebKit links it) but *no plugins* — they are
   `dlopen`ed, so `linuxdeploy` never copies them. GStreamer resolves its plugin
   directory relative to its own `.so`, so the bundled copy searches
   `$APPDIR/usr/lib/gstreamer-1.0`, finds nothing, and never falls back to the
   system path. See `docs/release.md` for the Fedora build caveat.

deb/rpm are unaffected — they depend on `webkit2gtk4.1`, which pulls a complete
system GStreamer.

### Reproducing / regression-testing

Blind GStreamer and open a note containing a video or audio block:

```sh
GST_PLUGIN_SYSTEM_PATH=/nonexistent GST_PLUGIN_PATH=/nonexistent npm run tauri dev
```

The note must render facades and stay alive. (Clicking a facade will fail to
play — that's fine and expected; it just must not abort.) To check a built
AppImage's bundled plugins directly:

```sh
LD_LIBRARY_PATH=<AppDir>/usr/lib GST_REGISTRY=/tmp/r.bin gst-inspect-1.0 autoaudiosink
```

That must print factory details, not `No such element or plugin`.

## Known limitation / follow-up

The blob holds the **whole file in memory** for its session lifetime. That's
fine for typical clips but not for very large video. Click-to-play limits the
damage — the fetch now happens on play rather than on note open, so a
media-heavy note no longer pulls every attachment into memory just to be
displayed — but a played file is still fully resident. True streaming playback
on Linux would require the heavyweight route — a custom **GStreamer plugin**
(`gstreamer-rs`) that teaches GStreamer the `asset://` scheme (see
<https://yanovskyy.com/blog/en/tauri-webkit>). Deferred until large-media
playback on Linux actually becomes a problem.
