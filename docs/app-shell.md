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
