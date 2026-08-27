# The app shell: one top bar, four grid tracks

The shell used to be three columns, with every view painting its own tall header
inside the main pane. It is now a **grid with a header row**, and there is
exactly one header in the app:

```
┌──────────────────────────────────────────────────────┐  44px
│  topbar (grid-column: 1 / -1)                        │
├──────────┬──────────┬────────────────────────────────┤
│ ribbon   │ sidebar  │ main-pane                      │  1fr
└──────────┴──────────┴────────────────────────────────┘
   11rem      260px         rest
```

`.app` owns both tracks as custom properties, so the two things that move are
one variable each: `--ribbon-width` (`2.75rem` collapsed / `11rem` open) and the
`.tree-hidden` modifier, which drops the middle column entirely.

## Why the tree column is *dropped*, not collapsed

`.sidebar` carries a `border-right` that spans the window. Squeezing the track to
`0px` would leave that hairline painted down the middle of the view. So
`App.tsx` stops rendering `<AppSidebar>` in step with the class:

```tsx
const treeHidden = useTheme((s) => s.treeHiddenViews.has(currentView));
…
{!treeHidden && <AppSidebar … />}
```

Keep those two in sync. A `.tree-hidden` grid with the aside still mounted puts
the sidebar in the main pane's track.

## Tree visibility is per-view

`treeHiddenViews` lives in `store/theme.ts` — app-scoped, in the same
`appearance` settings blob as `ribbonExpanded`, because it's a preference about
the app rather than about a vault's contents.

It's a `Set<AppView>`, persisted as an array (`treeHiddenViews: string[]`; JSON
has no Set). `TREE_HIDDEN_BY_DEFAULT` seeds it with `kanban`, `graph` and
`settings`: a board, a canvas and a settings page have nothing to do with the
note tree.

The toggle in the bar's lead segment flips the flag **for the view that's
open**, so the tree can stay on in Notes while Kanban runs full width. There is
deliberately no global "show tree" switch — that arrangement wouldn't be
reachable with one.

## How a view gets into the bar

`app/TopBar.tsx` exports two things:

- **`TopBarHost`** — renders the bar and publishes its slot element through a
  context. Wraps the rest of the shell in `App.tsx`. It emits no wrapper DOM of
  its own, so the bar and the three columns stay direct grid children of `.app`.
- **`TopBar`** — what a view renders to fill the slot, via `createPortal`.

A portal rather than props threaded down through `MainPane`, so a view declares
its title and actions in its own file, and nothing in between has to know they
exist. Only one view is mounted at a time, so only one component ever fills the
slot.

Most views never call `TopBar` directly: `ViewFrame` does it for them, and its
`title` / `subtitle` / `actions` / `toolbar` props are unchanged from when it
painted a header itself. The Notes view is the exception — its title is an
editable field in the document, so `editor/EditorHeader.tsx` renders `TopBar`
itself, with the note's action buttons.

**With no host above it, `TopBar` renders in place** (`.topbar-detached`)
instead of returning `null`. That's what the view tests get, since they mount a
view on its own; losing every one of a view's actions is a worse failure than
showing them in the wrong place.

### What belongs to the shell, not to a view

Three controls are rendered by the bar itself and read their state straight from
the stores:

| Control | Why it's shell chrome |
| --- | --- |
| tree toggle | changes a grid track of `.app` |
| back / forward (`NavHistoryButtons`) | navigation history is `useViewState` |
| inspector toggle | `inspectorOpen` is `useViewState`, and the drawer is a column of the main pane |

The inspector toggle is the one that sits *after* the view's own actions
(`.topbar-trail`); the other two are in the fixed lead segment.

The lead segment is exactly `calc(var(--ribbon-width) - 0.9rem)` wide — the
ribbon column minus the bar's own padding — so the rule down its right edge
lands precisely above the ribbon's border and the two read as one frame.

## Breadcrumbs

`noteCrumbs()` (`app/breadcrumbs.ts`) turns a note's `path` into the folders
above it. The path is display-only — a note's canonical identity is its UUID
(CLAUDE.md §5.3) — so the helper degrades to `[]` rather than guessing when the
path is missing or doesn't look like a note path. The leaf of the breadcrumb is
the note's **title**, never the file name: the two diverge after a rename.

## The sidebar's two new rows

`.sidebar-search` is a button wearing an input's clothes. There is one search
surface — the ⌘K palette — and this is a third door into it (the ribbon and the
shortcut being the other two), so it deliberately has no text box of its own to
fall out of sync with the palette's.

`.sidebar-new-note` is pinned under the tree. Creating a note was otherwise only
on the tree's right-click menu, which is fine once you know it and invisible
until then.

## What the view surfaces got, and what they didn't

Restyling the six mocked views mostly meant pointing existing markup at the
bar's control classes. Three things are worth writing down, because they're
places the mockups asked for something the data model doesn't have — or where
the code already had a better answer.

**Every control that lands in the bar wears `.topbar-button`.** Home's toolbar
buttons, the graph's panel toggle, the calendar's `‹ Today ›` and Templates'
"New template" each used to have a bespoke class with its own height and
padding. They're all one control now (`.topbar-button`, plus `.outlined` when
it carries a label), so the bar can't look like five views' worth of buttons in
a row. The two segmented controls — Kanban's board tabs and the calendar's
`Week | Month` — keep their own classes, since a segment group isn't a button.

**The Home "Vault" card trades the folder-group count for the day streak**, as
the mockups show. Group count measured a sidebar convenience rather than the
vault; the streak is what people look for. The standalone Streak widget stays
for anyone who wants it big.

**The calendar's "Show" filter list is not implemented.** The mockup lists named
calendars (Work / Personal / Travel / Reading) to toggle. An `Event` has a
`color` and nothing else — no calendar, no category — so those names would have
to be invented, and inferring them from whichever tag happens to own a colour
would be wrong the moment a colour isn't a tag's. That's a data-model feature,
not a revamp. "Next up" **is** implemented: it's a pure derivation from
`calendar.range()`, and it answers the question the mini month can't once you've
paged away from today.

**The graph's "Local graph" button is not implemented** either, for the same
reason: there is no neighbourhood-subgraph mode to toggle. The legend and the
zoom/fit controls are new and real — the legend is built *inside* `recolorGraph`
as it assigns each node's colour, so it can only ever say what the canvas
actually painted.

**Notes shows tags in one place, not two.** The mockup draws tag chips under the
note title *and* in the inspector. The inspector loads and edits them already;
a second copy in the document would mean a second data path for a read-only
echo, so the document keeps just the icon and the title.

### The month grid's weekday strip

Worth its own note because it changed a documented contract: the weekday names
moved out of the first week row's cells into a strip of their own. That removed
`MONTH_WEEKDAY_REM` and the per-row `headRem` special case that fed the lane
cap, the row capacity *and* the all-day overlay's offset. See
[`calendar-month-view.md`](calendar-month-view.md).

## Settings is a view, not a dialog

It used to be a `Dialog` with a 150px rail inside it. It's now `AppView`
`"settings"`, which changes three things:

- the **ribbon's Settings entry is a `kind: "view"`** like every other entry —
  it navigates instead of opening an overlay, so back/forward reach it and the
  ribbon shows it as the active section;
- the **section list is a rail in the shell sidebar** (`SettingsRail.tsx`),
  swapped in by `AppSidebar` exactly as the Calendar swaps in its mini month;
- the pane is `SettingsView.tsx`, code-split like the other non-editor views.

The two halves are in different parts of the tree, so which section is open
lives in `useViewState.settingsSection`, and the section list itself lives in
`settings/sections.ts` — the one file that knows what exists, in what order and
under which group. `SETTINGS_GROUPS` is derived from `SETTINGS_SECTIONS` rather
than listed a second time, so a section can't name a group the rail won't draw.

The old **Appearance** section was three questions on one long page; it's now
three sections — Appearance (theme, clock, comfort toggles), Editor (how note
content is set) and Language. **Keybindings** is called *Shortcuts* in the UI;
its id is unchanged, because renaming it would orphan the persisted overrides
keyed by it. **Vault** is new and read-only: it names the open vault and opens
its folder in the file manager. Switching, adding and deleting vaults stay on
the sidebar's vault-name menu (`VaultSwitcher`), which is where you already are
when you're thinking about vaults.

The rail's search filters **section names only**. Matching individual control
labels would mean enumerating every section's strings in a second place, and
they'd drift the first time one was reworded.

`ImportDialog` stays a dialog — it's a wizard that needs the whole window — and
`MainPane` passes Settings the two callbacks that reach back into shell-owned
flows: the post-cleanup tree refresh and the import launcher.

### The theme cards paint literal colours

`.settings-theme-preview-*` are the only literal hexes outside `index.css`'s
palette block that aren't a user-picked swatch. They have to be: a card showing
the Light theme while you're in Dark cannot use tokens, because tokens always
resolve to the theme in effect. They're copied from the palette table in
[`theming.md`](theming.md) — if the palette moves, move them with it. "System"
paints itself as a split down the middle rather than picking a side.
