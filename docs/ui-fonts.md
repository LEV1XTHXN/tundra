# UI fonts & text rendering

## The font

The whole app uses **Inter (variable)** — `@fontsource-variable/inter`, family
`'Inter Variable'`, set as `--font-sans` in `src/index.css`. BlockNote's editor
already defaults to an Inter stack, so using Inter in the shell too means the
shell and the editing surface match instead of mixing two typefaces.

We point BlockNote at the *same* variable instance via
`--bn-font-family: 'Inter Variable'` on `.editor-pane .bn-root`, because
BlockNote bundles only a **static** Inter (weight 400) — without this override the
editor couldn't take the weight nudge below.

> History: the shell was originally Geist (variable). It was swapped to Inter
> because Geist rendered noticeably thin on WebKitGTK and clashed with the
> editor's Inter.

## Why text can look thin/"pixelated" on Linux — and the weight nudge

Tauri uses a different webview per OS, and they don't rasterize type identically:

| OS | Webview | Text rendering |
|----|---------|----------------|
| Linux | WebKitGTK | thinnest — grayscale AA, light stems |
| macOS | WKWebView (WebKit) | also on the thin side |
| Windows | WebView2 (Chromium) | heaviest / most solid |

Measured from equal-resolution screenshots, the same copy had ~1.8× fewer solid
(non-antialiased) pixels on WebKitGTK than on a Chromium app — i.e. the strokes
are mostly soft gray edge, which reads as blurry/thin. Dark-text-on-light (our
light theme) makes it look thinner still than light-on-dark.

Mitigation: a **modest global weight bump**, one knob in `src/index.css`:

```css
:root { --ui-text-weight: 450; }   /* body + editor body copy */
```

- Applied app-wide (shell `body` + `.editor-pane .bn-editor`). Headings and bold
  marks keep their own heavier weights.
- **Global on purpose, not per-engine.** It also helps macOS (WebKit, also thin);
  on Windows/Chromium 450 is nearly indistinguishable from 400, so nothing is
  hurt. Engine-sniffing (UA strings / toggled classes) would be a fragile hack to
  maintain for little gain — a single consistent weight is the durable choice.
- Tune it in one place: toward `500` for heavier, `400` for the plain default.

## What is *not* the cause

- **Not display scaling.** Verified on 1920×1080 @ 1× (scaling-factor 1). Fine.
- **Not contrast.** The light theme's text is near-black (`#0a0a0a`) on white —
  higher contrast than the dark-theme app it was compared against.
- **CSS `-webkit-font-smoothing`** is a no-op on WebKitGTK/Linux (a macOS
  Safari/Chrome property). Don't add it expecting a fix.

## System-side knobs (per-developer, not in the repo)

The biggest crispness lever is the OS font config, which the app can't set:
- **Subpixel rendering → RGB** (from "None") sharpens edges on native-res LCDs.
- **Hinting → slight** is the sane default.

Set via GNOME Tweaks → Fonts or `~/.config/fontconfig/fonts.conf`. These affect
all WebKitGTK apps, not just Tundra.
