# UI fonts & text rendering

## The font

The whole app uses **Inter (variable)**, self-hosted under the family name
**`'Inter'`**, exposed as the `--app-font` stack and set as `--font-sans` in
`src/index.css`. `--app-font` is `'Inter'` first, then
`system-ui`/`Noto Sans`/`sans-serif` and emoji fallbacks. Inter covers Latin,
Latin-ext, **Cyrillic(-ext)**, Greek(-ext) and Vietnamese — so Russian/Ukrainian/
Greek/Vietnamese/accented-Latin all render in Inter. Scripts Inter lacks (CJK,
Arabic, Hebrew, Thai, Indic…) fall back to the platform UI font.

### ⚠️ The editor content is styled by BlockNote's `.bn-default-styles`, not `--bn-font-family`

This one cost real debugging time. BlockNote applies **two** different font hooks:

- `.bn-root { font-family: var(--bn-font-family) }` — the editor chrome/menus.
- `.bn-default-styles { font-family: Inter, "SF Pro Display", …, Cantarell, …, sans-serif }`
  — the actual **editor content**. This is a **hardcoded** stack that asks for the
  literal family name **`Inter`** and does **not** read `--bn-font-family`.

So overriding `--bn-font-family` alone leaves the *content* untouched. If our
self-hosted face is named anything other than `Inter` (we first tried
`'Inter Variable'`), the content's exact request for `Inter` doesn't match it and
falls through to the system fallback — on Fedora, `fc-match Inter` → **Noto Sans**
(and menus → Cantarell). Because Noto and Inter are nearly identical by eye, this
looked like "Cyrillic uses the old font" while the shell (which uses `--app-font`)
rendered Inter correctly — a very confusing split.

**The fix is to give BlockNote the font it already asks for — by *name*, not by
override.** In `src/styles/inter-variable.css` the self-hosted `@font-face` faces
are named plain **`'Inter'`**. Then every consumer resolves to our full-subset
variable font through its *own* defaults, with no reaching into BlockNote internals:

- **Shell** — `--app-font` leads with `'Inter'`.
- **Editor chrome** (menus/placeholders) — we set BlockNote's *public* theming
  variable `--bn-font-family: var(--app-font)` on `.bn-root`, so its fallback chain
  matches the shell.
- **Editor content** — BlockNote's own `.bn-default-styles { font-family: Inter, … }`
  resolves to our `'Inter'` by name. We **do** override that internal class in one
  narrow way — `.editor-pane .bn-editor .bn-default-styles { font-family: var(--app-font) }`
  — but only to append the emoji fallback (see [Emoji](#emoji-a-single-twemoji-font)).
  `--app-font` is still `'Inter'`-first, so text is unchanged; if a BlockNote
  upgrade renames the class the worst case is emoji regressing to the platform
  font, never a text regression.

This also replaces BlockNote's bundled latin-only static `"Inter"`, which we no
longer import.

## Emoji: a single Twemoji font

Every emoji in the app — **note icons**, the **emoji picker**, and emoji **typed
into note bodies** — renders from one self-hosted face, **`'Twemoji'`**
(`src/styles/twemoji.css`, vendored to `public/fonts/twemoji/twemoji.woff2` from
the `twemoji-colr-font` npm package, **v15**). Before this, only note icons used
Twemoji (as per-emoji SVG `<img>`s); the picker and editor fell through to the
platform emoji font, so the same emoji looked different in three places.

- **Why a font, not SVGs.** Emoji typed into a `contenteditable` can't be swapped
  for `<img>`s without fighting the cursor/IME/undo — fragile, against the prime
  directive. A color font is the robust way to render emoji in editable text, and
  it also fixes the picker and icons for free. It's a **COLR/CPAL vector** font
  (layered shapes, not embedded bitmaps), so it stays sharp at any size — a large
  open-note header icon is as crisp as the SVGs it replaced.
- **How text/picker pick it up.** `'Twemoji'` **leads** `--app-font`, but its
  `@font-face` is `unicode-range`-scoped to the emoji blocks (styles/twemoji.css).
  For non-emoji characters the browser skips the face entirely and falls through to
  Inter, so it can't hijack plain text/digits/`#`/`*`; for emoji it wins because
  it's first. **Leading is required, not optional, on Linux/WebKitGTK:** fontconfig
  auto-substitutes Noto Color Emoji whenever an *earlier* family (Inter, system-ui,
  sans-serif…) is asked for an emoji glyph, so a `'Twemoji'` listed *last* is never
  reached — the emoji resolves via Noto first. (This was the bug: note icons, which
  set `'Twemoji'` first explicitly, rendered correctly while the picker and typed
  text — Twemoji last — showed the system emoji.) The platform emoji faces
  (`Apple Color Emoji`/`Segoe UI Emoji`/`Noto Color Emoji`) stay at the tail as a
  load-failure fallback. Keycap emoji degrade gracefully: ASCII is excluded from
  the range, so the base digit stays Inter and only the enclosing keycap is Twemoji.
- **Two surfaces don't inherit `--app-font` and needed explicit wiring** (each
  silently fell back to the platform emoji font until fixed):
  - **Editor content.** BlockNote puts both classes on the *same* element
    (`class="bn-editor bn-default-styles"`), so the override must be the COMPOUND
    selector `.editor-pane .bn-editor.bn-default-styles` (no space). A descendant
    `.bn-editor .bn-default-styles` matches nothing.
  - **Emoji picker.** frimousse renders each emoji button with an INLINE
    `font-family: var(--frimousse-emoji-font)` **and** sets that var inline on its
    own root (default: Apple Color Emoji / Twemoji Mozilla / …). Inline beats a
    stylesheet, so overriding the var in CSS does nothing — we override the button's
    `font-family` directly with `!important` (`.icon-picker-emoji-root
    [frimousse-emoji]`), which is what beats an inline style.
- **How icons pick it up.** `NoteIcon.tsx` renders the stored codepoint(s) back to
  the emoji string (`@twemoji/api`'s `convert.fromCodePoint`, joining hyphenated
  ZWJ sequences) inside a `.twemoji-emoji` span sized from the caller's size class.
  The old SVG path (`nav/twemoji.ts`, `nav/twemojiImg.tsx`) and the `@twemoji/svg`
  dependency were removed; `@twemoji/api` stays only for codepoint conversion.
- **Bigger emoji in note bodies, same-size text.** A second `@font-face`
  `'TwemojiText'` points at the same file with `size-adjust: 125%` — the descriptor
  scales only that font's glyphs, so emoji get larger while the surrounding Inter
  text is untouched. It's used only in the editor content stack
  (`.bn-editor.bn-default-styles { font-family: 'TwemojiText', var(--app-font) }`),
  not in icons/picker. Tune the percentage in `styles/twemoji.css`.
- **WebKitGTK.** COLRv0 is supported there; still worth an eyeball on a large icon
  per the usual Linux-render caveat. `size-adjust` needs a recent WebKitGTK — if
  it's unsupported the emoji simply render at 1× (harmless no-op).

### Loading the woff2 (self-hosted, offline-first)

Being a local-first app, we vendor the font rather than depend on a CDN or a
package's CSS. The 7 subset woff2 files live in `public/fonts/inter/` (committed to
the repo) and are declared in `src/styles/inter-variable.css` with the standard
**`format('woff2')`** hint and `font-weight: 100 900` (keeps the variable weight
axis for the 450 nudge). `@fontsource-variable/inter` is kept only as a
**devDependency** — the *source* we copied those files from; nothing imports it at
runtime. Regenerate by re-copying `files/*.woff2` if the version bumps, keeping the
family name `'Inter'`.

Two reasons we don't just `import '@fontsource-variable/inter'`: (1) it registers the
family as `'Inter Variable'`, the wrong name for BlockNote (see above); and (2) its
CSS declares `format('woff2-variations')` — a hint some WebKitGTK builds don't
recognize. Self-hosting with the plain `format('woff2')` hint and our own family
name sidesteps both, and absolute `/fonts/...` paths are served verbatim by Vite in
dev *and* build (a node_modules bare-specifier `url()` resolves at build but not in
Vite's dev server).

> Verifying without eyeballing: Inter vs Noto Sans are visually near-identical, so
> screenshot comparison is unreliable. To check which font actually rendered, measure
> real text width against forced `'Inter'` vs `'Noto Sans'` spans, or use the
> weight-axis trick (only the variable font gets narrower at `font-weight: 100`).

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
