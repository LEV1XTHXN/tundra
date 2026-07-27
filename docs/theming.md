# Theming: the colour token system

Every colour in the app comes from `src/index.css`. This note explains the two
layers, why the palette's names don't line up with shadcn's, and the handful of
rules you have to know before adding a colour.

## Two layers

```
--pal-*            13 hand-authored values per theme   ← the ONLY literal colours
   ↓ var()
--background,      the shadcn contract + our additions ← what components consume
--foreground, …
```

Layer 2 never contains a literal colour; it's all `var(--pal-*)`. That's what
makes `.dark` cheap: it redefines the **13 palette values** and every semantic
token cascades. Only the tokens whose *mapping* differs by theme are repeated
there (currently three — see [Dark mode](#dark-mode-and---accent-text)).

`index.css` started life as `shadcn init` output (preset nova, base neutral).
It is now hand-authored — **do not regenerate it with the shadcn CLI**, that
would wipe the palette.

## The palette

| Name | Light | Dark |
| --- | --- | --- |
| `--pal-background` | `#ffffff` | `#171717` |
| `--pal-background-alt` | `#edefee` | `#222222` |
| `--pal-surface` | `#f2f4f2` | `#252525` |
| `--pal-surface-elevated` | `#ffffff` | `#303030` |
| `--pal-text-primary` | `#171717` | `#f5f5f5` |
| `--pal-text-secondary` | `#5e6662` | `#b7bbb8` |
| `--pal-text-tertiary` | `#8d9591` | `#808683` |
| `--pal-accent` | `#3b5249` | `#3b5249` |
| `--pal-accent-hover` | `#4a675b` | `#4a675b` |
| `--pal-accent-pressed` | `#30423b` | `#30423b` |
| `--pal-accent-subtle` | `#e0e8e4` | `#50685f` |
| `--pal-border` | `#dce2de` | `#383838` |
| `--pal-divider` | `#e5e9e6` | `#2d2d2d` |

### The light ramp is spread on purpose

The neutral steps go `background` → `surface` → `background-alt` → `divider` →
`border`, at L\* `100 / 96.0 / 94.3 / 92.0 / 89.3`. **Keep it monotonic.** The
original values put `surface` and `background-alt` at L\* 98.2 / 97.1 — within
~2 points of the background — and the chrome (sidebar, ribbon, cards) read as
one flat white sheet.

`--pal-accent-subtle` is *not* part of that ramp: it's the hover/selected state,
sized to sit ~4.7 L\* below `--pal-surface`. If you move the surfaces, move it
with them, or hover feedback inside cards and the sidebar goes mushy.

## The names cross over

This trips people up. shadcn and the palette both use the word "accent", for
different things:

| Palette name | shadcn token | What it actually is |
| --- | --- | --- |
| `accent` | `--primary` | the brand colour — button fills, the today marker |
| `accentSubtle` | `--accent` | the hover / selected **background** |

So `--accent` is *not* the brand green. Reach for `--primary` (or
`--accent-text`, below) when you want the green.

## Tokens with no shadcn equivalent

| Token | Use it for |
| --- | --- |
| `--accent-text` | the accent as **text / icon / border / focus ring** |
| `--primary-hover` / `--primary-pressed` | `:hover` / `:active` of an accent-**filled** control |
| `--subtle-foreground` | a third text tier below `--muted-foreground` — timestamps, hints, counts |
| `--divider` | a hairline **between sections of one surface** |

### `--primary` vs `--accent-text`

Filling a shape → `--primary`. Colouring a glyph or a 1px line →
`--accent-text`. This isn't stylistic: see below.

Thin lines count as glyphs, not fills. The nav reorder indicator, the pinned-row
bar and the column-resize handle are all `background:` declarations that are 2px
wide, and they use `--accent-text`.

### `--border` vs `--divider`

`--border` **outlines** a component (a full-box `border:`) or separates two
top-level panes. `--divider` **separates within** one surface — a toolbar's
bottom edge, rows in a list, the calendar grid's inner lines. `--divider` is
deliberately one step lighter, so using it for a pane boundary makes the
boundary disappear.

### The calendar's chrome frame

`.sidebar` and `.ribbon` are `--card`, and so is the view header **while the
calendar is showing** (`.view-frame:has(.calendar) .view-frame-header`). Left
rail + top bar therefore read as one continuous frame around the grid, whose
cells stay on `--background`. Only the calendar does this — it's the one view
whose body is full-bleed right up to the header, so a tone difference there
lands as a visible seam instead of as padding. The rule sits with the other
`:has(.calendar)` rules that hand the grid its own outer edges, and covers month
and week alike because `.calendar` is the view root, not a per-mode class.

### `--subtle-foreground`

This replaced the old `color: var(--muted-foreground); opacity: 0.55` idiom.
Don't reintroduce that — dimming with `opacity` produces a different colour on
every surface it lands on, and lands *below* the tertiary tone it was imitating.

## Dark mode and `--accent-text`

The accent is the same `#3b5249` in both themes. As a **fill** that's fine
(white on it is 8.44:1). As **text** in dark mode it is `2.12:1` on the
background — unreadable.

So dark mode lightens the accent toward the primary text colour rather than
introducing a second hand-picked green:

```css
--accent-text: color-mix(in oklab, var(--pal-accent) 50%, var(--pal-text-primary));
```

That resolves to ≈`#93a09a`.

| Contrast of `--accent-text` (dark) against | ratio |
| --- | --- |
| `--pal-background` `#171717` | 6.60:1 |
| `--pal-surface` `#252525` | 5.65:1 |
| `--pal-surface-elevated` `#303030` | 4.86:1 |

The `50%` is the tunable knob: higher is greener and lower-contrast. `55%` is
the floor that still clears AA on every surface.

### Other measured ratios

| Pair | ratio |
| --- | --- |
| `--primary-foreground` on `--primary`, light (`#ffffff` on `#3b5249`) | 8.44:1 |
| `--primary-foreground` on `--primary`, dark (`#f5f5f5` on `#3b5249`) | 7.74:1 |
| `--accent-foreground` on `--accent`, light (`#171717` on `#e0e8e4`) | 14.37:1 |
| `--accent-foreground` on `--accent`, dark (`#f5f5f5` on `#50685f`) | 5.52:1 |
| `--muted-foreground` on `--background` / `--card`, light | 5.91:1 / 5.35:1 |
| `--subtle-foreground` on `--background` / `--card`, light | 3.07:1 / 2.78:1 |
| `.find-match` text, light / dark | 10.01:1 / 6.04:1 |

`--subtle-foreground` is intentionally below AA for body text — it is the
de-emphasis tier, only for metadata that repeats information available
elsewhere. Never put load-bearing text on it.

## Not covered by the palette

- **`--destructive`** keeps its stock shadcn red (light + dark). The palette has
  no warm ramp, and a destructive action needs to read as destructive.
- **`TAG_PALETTE`** (`src/store/tagColors.ts`) — 8 pastels, theme-invariant by
  design, persisted per vault. Shared by tag chips, Kanban, folder properties,
  graph nodes, and calendar events. Pair it with the `contrastText(hex)` helper
  from the same module. See [Changing TAG_PALETTE](#changing-tag_palette) — it
  is not a normal edit.
- **Note-banner gradients** (`src/editor/NoteBanner.tsx`) and **home-background
  presets** (`src/home/HomeBackgroundPicker.tsx`) — light-only pastels by
  design, and per-note/per-vault user choices.
- **`--chart-1`…`--chart-5`** are still the stock grayscale values and are
  unreferenced anywhere. Redefine them before you use them.

## Changing `TAG_PALETTE`

The eight swatches are generated at a **single OKLCH lightness and chroma**
(currently L `0.78` / C `0.11`), one per hue. That uniformity is the point: no
swatch is louder than its neighbours. Two constraints on any retune:

- **≈2:1 on white.** Graph nodes are bare dots with no outline, so a swatch has
  to survive the light-theme canvas. At L `0.78` they sit at 1.9–2.1:1 on
  `#ffffff` and 8.5–9.4:1 on the dark canvas. Lighter than that and the graph
  washes out.
- **All on one side of the `contrastText` threshold.** That helper flips label
  colour at luminance `0.6`; the current eight are 0.66–0.72, so every chip gets
  dark text. A swatch that straddles the line makes the label colour flip
  between neighbouring hues, which reads as a bug.

### A palette change needs a migration

A *chosen* colour is persisted as a literal hex, so changing the palette only
affects future picks — everything already coloured keeps its old hex and the
vault goes visibly mixed. Three files hold palette hexes:

| Surface | File | Owner |
| --- | --- | --- |
| tag colours (Kanban column colours write through to these) | `.vault/config/tag-colors.json` | frontend config passthrough |
| folder-table `select` / `multiSelect` options | `.vault/config/folder-views.json` | frontend config passthrough |
| calendar events | `.vault/config/calendar.json` | Rust core (`CalendarStore`) |

`src/store/paletteMigration.ts` remaps all three at vault open, then records an
id in `.vault/config/migrations.json` so it runs once. Events go through the
`recolor_events` command — they're core data — which takes the *same* map; the
palette is never duplicated in Rust.

To retune the palette, **add a new entry there; never edit an existing one.** A
migration records something that happened once, so both sides of its map are
frozen literals. Editing v1 in place would rewrite history for any vault that
hadn't opened yet. The `lands every migrated colour on the current palette` test
in `paletteMigration.test.ts` is the tripwire that catches a forgotten entry.

Ordering matters: `useAppStores` awaits the migration *before* loading
`useTagColors` / `useFolderViews`, because those stores read the very files it
rewrites and would otherwise write stale colours back over it.

## Graph tokens must stay plain hex

Sigma renders to WebGL/canvas and needs a *resolved* colour, so the graph's
chrome is declared as `--graph-*` tokens and read back with
`readPaletteColor()` (`src/graph/paletteColor.ts`), which is just
`getComputedStyle(document.documentElement).getPropertyValue(token)`.

**Custom properties do not resolve `color-mix()` on read.** `getPropertyValue`
returns the literal declaration, so a `--graph-*` token defined as a
`color-mix()` hands sigma the string `"color-mix(in oklab, …)"`, which its
colour parser rejects — the node or edge renders black. Every `--graph-*` token
must therefore be a plain hex value or a `var()` chain that ends in one. That's
why `--graph-node` repeats `#93a09a` in `.dark` instead of pointing at
`--accent-text`.

`--graph-edge` is the one value picked by hand rather than mapped from the
palette: edges are 1px, and at that width an alpha colour composites most of the
way back to the canvas and vanishes, so each theme gets a solid pre-blended tone
(2.22:1 light / 2.49:1 dark against its own canvas).

Colours are re-read in `GraphView`'s `resolvedTheme` effect. That effect depends
on `resolvedTheme` not to *read* it but to re-run **after** the store has
flipped `.dark` on `<html>` — only then do the tokens resolve to the new values.
The hover-pill colours reach `nodeLabel.ts` through `setHoverPillColors()`,
because sigma's `defaultDrawNodeHover` has no slot to thread app state through.

## Adding a colour

1. If it's a new *value*, add it to the palette in **both** `:root` and `.dark`.
2. If it's a new *role*, add a semantic token that references the palette.
3. Never write a literal hex outside the palette block. The exceptions already
   in the file are labelled — they sit over arbitrary images (`.note-banner-button`)
   or user-picked swatches (`.tags-swatch`), where no theme token applies.
4. Add a Tailwind utility for it in the `@theme inline` block if components will
   need it as a class.

## Verifying a change

There's no visual regression suite. To eyeball both themes without a Tauri
build, drop a temporary harness page at the repo root that does
`import "/src/index.css"`, run `npm run dev`, and screenshot it headless:

```sh
firefox --headless --profile /tmp/ffprof --window-size=1280,1900 \
  --screenshot=/tmp/light.png "http://localhost:1420/harness.html"
```

Add `document.documentElement.classList.add("dark")` for the dark shot. Delete
the harness afterwards. Then confirm on **WebKitGTK** via `npm run tauri dev` —
per CLAUDE.md §8.8 that's where rendering quirks actually show up.
