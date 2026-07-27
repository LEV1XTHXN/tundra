# Calendar month view

The month grid (`src/calendar/CalendarView.tsx`, `MonthGrid`) is laid out like
Google Calendar's: timed events are unfilled `● 09:30 Title` rows, while all-day
events and multi-day periods are filled bars drawn as ONE continuous span across
the days they cover. That second part is why the grid isn't a plain 42-cell CSS
grid.

How events are *created and edited* — the dialog, typed times, and repeats — is
[`calendar-events.md`](calendar-events.md). One thing from there matters to every
grid: a repeating event is expanded into several events sharing one `id`, so React
keys and per-event lookups must use `eventKey(ev)`, not `ev.id`.

## Where the outer lines come from

The grid runs flush to the main pane on every side — no `--view-padding-x` gutter,
unlike every other view. Its **top and left** edges are its own borders, meeting in
a rounded top-left corner; the right and bottom edges have no rule at all (they're
the window edge), and everything inside is a cell's own
`border-right`/`border-bottom`, cleared on the last column and row.

Owning those two edges is back-to-front from what you'd expect — the view header
and the sidebar already draw a line in both places — so both are turned
transparent while the calendar is showing:

```css
.app:has(.calendar) .sidebar                  { border-right-color: transparent; }
.view-frame:has(.calendar) .view-frame-header { border-bottom-color: transparent; }
```

Two reasons, and both need the swap:

- The sidebar spans the full window height, so its border leaves a stub of
  vertical line beside the view header, hanging above the grid's corner.
- A corner can only be *rounded* if one element draws both of its edges. With the
  header owning the top line and the grid the left one, the best you get is a hard
  L of two elements' borders.

The scope is `.calendar` — the view root, present in **both** modes — rather than
`.calendar-month`: week mode is framed identically (see below), so there's nothing
mode-specific left to distinguish. A browser without `:has()` support degrades to
the old square-cornered pair of rules rather than losing any line. Transparent
rather than `none` throughout, so the 1px stays and nothing shifts.

## One element per week, plus an overlay

A flat grid can't draw a bar across several day cells, so the body is one
`.calendar-week-row` per week, each holding two layers:

- `.calendar-week-cells` — the 7 day cells (number, row list).
- `.calendar-alldaylane` — an absolutely-positioned 7-column grid on top,
  `pointer-events: none` (bars re-enable it) so cell hovers still work. Each bar
  sets `grid-column: <colStart+1> / span <span>` and `grid-row: <lane+1>`.

`src/calendar/monthLayout.ts` computes that placement — pure functions, unit
tested in `monthLayout.test.ts`:

- `isSpanning(ev)` — all-day, or crossing a calendar-day boundary. Everything
  else stays a row (a single-day timed event has one clock time to lead with; a
  period doesn't).
- `packWeek(week, events)` — clips each spanning event to the week, then assigns
  the topmost lane free for every column it covers. `continuesLeft/Right` mark
  the edges cut by the week boundary; the CSS squares those corners and runs the
  bar to the cell wall so the halves read as one event.

An event crossing a week boundary is simply two bars — `packWeek` runs per week,
so nothing needs to know about the split.

## "+N more" is measured, not guessed

Cells are fixed-height (`grid-auto-rows: 1fr`), so a busy day has to collapse.
How many rows fit is computed from the *measured* week-row height (one
`ResizeObserver` on `.calendar-month-body` — every row is the same height, so one
measurement covers all 42 cells) minus the head and the lanes the week's bars
occupy, divided by the row height.

Those heights live as rem constants in `CalendarView.tsx`
(`MONTH_HEAD_REM`, `ALLDAY_LANE_REM`, `MONTH_ROW_REM`, `MONTH_MORE_REM`,
`MONTH_WEEKDAY_REM` — the lane one has no `MONTH_` prefix because week mode's
all-day strip draws the same bar and offsets by the same pitch) and
**must match** `.calendar-cell-head` /
`.calendar-allday-bar` / `.calendar-event-row` / `.calendar-more` /
`.calendar-weekday-label` in `index.css`. A drift shows up as a wrong "+N more"
count, not as a layout break — so it's easy to miss. (Same contract
`HOUR_HEIGHT_REM` already has with the week view's hour grid.)

There is no weekday header strip: the weekday names head the **first week row's
cells** (`.calendar-cell-head.with-weekday`), as in Google Calendar. So that row's
head is `MONTH_HEAD_REM + MONTH_WEEKDAY_REM` tall while the rest are
`MONTH_HEAD_REM` — hence the per-row `headRem`, which feeds *three* things: the
lane cap, the row capacity, and the bar overlay's `top` offset. Miss one and the
first row either mis-counts its overflow or hangs its bars over the labels.

Lanes are capped too: if a week stacks more periods than fit, the extra bars
count toward the day's overflow instead of spilling out of the cell. Before the
first measurement `rowHeight` is `null` and nothing collapses — hiding rows on
the first paint and showing them again reads as a flicker.

## Right-click is how you create and delete

`src/calendar/CalendarContextMenu.tsx` — same split as the nav tree's
`NavContextMenu`: presentational menus dispatching through one
`CalendarMenuActions` object, while `CalendarView` keeps the dialog state and
owns the mutations. Two menus, and the target decides which opens:

- **day** (`CalendarDayMenu`) — New event · Link a note to this day. On the month
  cell, the week hour column, and the week day header.
- **event** (`CalendarEventMenu`) — Edit event… · Delete event. Delete goes
  straight to `calendar.deleteEvent` with no confirmation, matching the event
  dialog's own Delete button.

Every event sits inside a day that has its own menu, so `EventContextMenu` wraps
each one with `onContextMenu={(e) => e.stopPropagation()}` — Radix composes our
handler ahead of its own, and stopping *propagation* (not the default) keeps the
trigger working while the day menu behind it never opens. Same mechanism as
`NavTree`'s rows. The all-day lane's `pointer-events: none` does the rest: empty
lane space falls through to the cell's menu.

The month cells consequently carry **no hover chrome** — the old hover `＋`/`🔗`
buttons and their `.calendar-cell-actions` styles are gone, as in the nav tree.

**Left-click drills in**: clicking a month cell switches to week mode on that
day's week (`onDayClick` → set the shared cursor, set the mode — the cursor
already means "which week"). The cell is one big target that *contains* buttons
— event rows, note open/unlink, "+N more" — whose clicks bubble up to it, so
`cellClick` ignores any click that landed on a `button`; without that guard,
opening an event would swap the view out from under its own dialog. All-day bars
need no guard: they live in the overlay lane, a sibling of the cells. The only
affordance is `cursor: pointer` — the month stays hover-chrome-free.
`MonthDayClick.test.tsx` pins both halves.

Week mode wires **one menu per day column**, not per hour slot: 168 Radix
triggers a week buys nothing when the clicked hour can be read from the pointer.
`hourAt` reads it from `snappedMinutesAt` (below), on `onContextMenuCapture` so
it always lands before Radix opens the menu.

`CalendarContextMenu.test.tsx` covers all of it (jsdom): innermost-menu-wins,
delete reaching the service and refreshing, and both create paths targeting the
right day/hour.

## Dragging out a time slot

In week mode a press in a day column starts a drag: sweep, and release opens the
event dialog pre-filled with the span you swept. Everything snaps to
`SNAP_MINUTES` (15) — **in the maths only**. The grid still draws one rule per
hour; there are no quarter-hour lines, and `.calendar-hour-slot` is untouched.

`snappedMinutesAt(col, clientY, rem)` is the single place grid geometry lives —
pixels → minutes past midnight, clamped to the day, floored to the snap grid.
The right-click path divides its result by 60; the drag uses it whole. The
column element (not a captured rect) is what's stored in the `SlotDrag`, so a
mid-drag scroll of `.calendar-week` re-measures instead of skewing.

`dragRange` turns the gesture into minutes: ordered (so upward drags work), and
inclusive of the slot under the pointer — the shortest drag is one 15-minute
block. A press that never moves more than `DRAG_THRESHOLD_PX` isn't a drag and
names no length, so it gets `DEFAULT_EVENT_MINUTES` (one hour) at the snapped
mark it landed on. Moves and the release listen on the **window**, as in
`FolderTable`'s column resize, so a gesture that runs off the grid still ends.

Two consequences worth knowing:

- The dialog's pre-fill is a `TimeRange`, not the old `hour` number — a swept
  span can't be expressed as an hour. `range` absent still means all-day, which
  is what a month cell or the week header's menu passes.
- `.calendar-hour-slot`'s `onClick` is now guarded by `e.detail === 0`, i.e.
  **keyboard activation only**. The mouse click that follows a press is the tail
  of the drag the column already handled; letting it through would open a second
  dialog, hour-aligned and ignoring where in the hour the press landed. The
  buttons stay for their hover affordance, `aria-label`, and tab order.

`.calendar-week-draft` previews the span: same box as `.calendar-week-event` so
what you drag is what you get, `pointer-events: none` so the drag keeps
measuring the column underneath. `WeekDragCreate.test.tsx` covers both
directions, the preview's geometry, the click degenerate case, the double-dialog
guard, and that a press on an existing event starts nothing.

## Sidebar and the shared cursor

While `view === "calendar"`, `AppSidebar` swaps the note tree for
`CalendarSidebar` (a mini month) — a calendar is navigated by date, not by note.
Because the sidebar and the grid are siblings in the shell, the month cursor
lives in `useViewState` as `calendarCursor` (transient view state, deliberately
NOT part of a `NavLocation`), not in `CalendarView`'s local state.

The little month itself is `src/calendar/MiniMonth.tsx`, shared with Home's
Calendar widget. Its `fitHeight` prop is the only difference between the two:
Home is freely resizable and needs cells sized in JS to fit both dimensions;
the fixed-width sidebar takes its natural height with `aspect-ratio: 1` cells.

## Month names are `LLLL`, not `MMMM`

`i18n/dateLocale.ts` exports `formatCap` — date-fns `format` with the first
character upper-cased — because Russian and German month/weekday names come back
lower-case, which reads as a typo in a heading. Use it wherever a formatted date
*starts* a label; plain `format` mid-sentence.

For a month shown **on its own** (the view title, the mini month's header) the
format token is `LLLL`, the standalone/nominative form. `MMMM` is the genitive
form meant to sit next to a day number, so it yields "Июля 2026" where the
heading wants "Июль 2026". Keep `MMM`/`MMMM` where a day number is present
("1 июл.", "воскресенье, 26 июл.").

## Week mode

Shares the **outer frame** and nothing else. `.calendar-week` is flush to the pane
on all four sides like the month grid, with the same own top+left borders and
rounded top-left corner, fed by the same donated sidebar/header rules — so
switching modes doesn't move the grid's edges. Because it's flush, the last day
column clears its `border-right` (`.calendar-week-daycol-head:last-child`,
`.calendar-week-daycol:last-child`), the week-mode counterpart of
`.calendar-cell:last-child`. Its `overflow-y: auto` — the hour grid is
24 × `HOUR_HEIGHT_REM` tall, always taller than the pane — is also what clips the
sticky day-header row to that rounded corner.

### Every rule is drawn once, by exactly one element

The gutter is a column of times, so the only rule it owns is the vertical one
dividing it from the days. Four `border` declarations are deliberately absent,
each because something else already draws that exact line — and a second 1px
border landing on the first reads as a 2px line next to everything else's 1px,
which is very visible and hard to trace back:

- `.calendar-hour-label` has **no `border-top`**. The hour rules belong to the day
  columns (`.calendar-hour-slot`), where they mean something; repeating each as a
  stub across the gutter just fences the time in. Heights still line up because
  `box-sizing: border-box` is global — the inline `HOUR_HEIGHT_REM` is the outer
  height with or without a border.
- `.calendar-hour-label` has **no `border-right`** either. The labels fill the
  gutter's width, so it would sit 1px inside `.calendar-week-gutter`'s own
  `border-right` — the container draws that divide, full height, on its own.
- `.calendar-hour-slot:first-child` clears its `border-top`: the 00:00 rule would
  stack on `.calendar-week-header`'s `border-bottom` immediately above it. The
  header's border wins because it also spans the gutter, which the slots can't.
- The header's two gutter cells (`.calendar-week-daylabels > .calendar-week-gutter`,
  `.calendar-week-alldays > .calendar-week-gutter`) clear their `border-right`.
  The header cells above the times are empty, so a rule there separates nothing
  and reads as a stub hanging off the grid's top edge. The *body* gutter keeps
  its rule — that one is the real divide.

Each label is pulled up half a line (`translateY(-0.5em)`) so it sits **on** its
hour's rule. The first one is `visibility: hidden`, as in Google Calendar — it has
no rule above it, only the grid's top edge, so it reads as a stray number rather
than a marker for a line. `visibility`, **not** `display: none`: the element still
has to hold its `HOUR_HEIGHT_REM`, or every label below it slides up an hour and
the gutter stops matching the day columns.

### The all-day strip

Multi-day events are the one thing week mode does **not** do its own way: the
hour grid draws only events that begin and end on the same day, and everything
`isSpanning` — all-day events, and timed ones crossing midnight — is a bar in a
strip above it, laid out by the same `packWeek`. Before that split, a Mon 14:00
→ Wed 10:00 event was clipped into three blocks (Monday 14:00–24:00, all of
Tuesday, Wednesday 00:00–10:00) that swallowed the grid, and a 3-day all-day
event was three disconnected chips with nothing tying them together.

`.calendar-week-header` is therefore two stacked grids rather than one, both
`3.5rem repeat(7, 1fr)`:

- `.calendar-week-daylabels` — the day name + number per column.
- `.calendar-week-alldays` — one cell per day (the "+N more", note links, the
  link-a-note button) plus `.calendar-week-alldaylane`, the bar overlay. Same
  shape as the month row's `.calendar-alldaylane`, offset `left: 3.5rem` past
  the gutter so its column 1 is Monday; each day cell reserves the lanes'
  height as `padding-top` so its notes sit clear of them.

Two grids, not one, for the reason the month body is one element per week: a bar
spanning day columns needs a container the day cells don't subdivide. The
`:last-child` border reset can't be used on the strip either — the overlay is
its last child — so Sunday's rule is cleared by column position
(`.calendar-week-allday:nth-child(8)`).

The lane cap is a flat `WEEK_ALLDAY_LANES`, not a measurement: the strip is
inside a **sticky** header, so lanes growing freely would push the hour grid off
screen rather than overflow a fixed cell. Bars past the cap collapse into a
per-day "+N more" that opens the same `.calendar-day-popover` month uses, listing
every bar covering that day — the day's timed events are already visible in the
grid below, so bars are all there is to collapse.

Otherwise week mode is untouched by the month layout: `.calendar-week-*` and its
own hour grid. (`.calendar-event`, the old per-column all-day chip, is gone —
single-day all-day events are `isSpanning` too, so they come through `packWeek`
as span-1 bars and look like every other bar in both modes.)

### The event block

`.calendar-week-event` is modelled on Google Calendar's: **flush to its column**,
title on the first line, its time on the second — and a narrow accent stripe down
the left edge.

**It has no border, and no left/right inset.** Both are deliberate, and both used
to be there. A 1px border on all four sides costs 2px of the 28px a 30-minute
block has to spend, which is most of the difference between fitting a line of
text and clipping it; and an inset box reads as floating *inside* the column
rather than occupying the time it covers, which is the one thing an hour grid is
for. The only gap is the 1px the inline `width` falls short of the block's share
of the column — enough to separate two side-by-side blocks and to keep
`.calendar-week-daycol`'s own rule visible on the right.

The stripe is an **inset `box-shadow`, not a `border-left`**: a border would mitre
diagonally across `--radius-sm` at the two left corners, and it would take its
3px out of the box model, so the block would no longer be exactly as wide as the
overlap maths asked for. Its colour is `var(--primary)` in both themes, per the
token rule at the top of index.css — a *filled* shape takes `--primary`, only a
glyph or a hairline takes `--accent-text`. It is the one part of the block that
never varies: the body carries the event's own palette colour (or `--secondary`
when it has none), so the stripe stays a constant marker across every event
rather than a second copy of information the fill already gives.

**Time beside the title, or under it.** `SHORT_EVENT_MINUTES` (45) switches the
block between `flex-direction: column` and the `.compact` row, and the number is
pure arithmetic on `HOUR_HEIGHT_REM`: at 3.5rem/hour a 45-minute block is 42px,
which clears two 15px lines plus padding, and a 30-minute block's 28px does not.
A compact block also shows the **start time only** — an end time on the same line
is the first thing a narrow column ellipses away. Both readouts go through
`clockPattern()`, the one place the app's 12h/24h setting turns into a date-fns
pattern, shared with the month day rows and the drag draft so the three can't
drift apart. The full span always survives in the `title` tooltip.

### Overlapping events: `packDay`

Simultaneous events used to render at identical `left`/`right`, i.e. exactly on
top of each other — the topmost one simply hid the rest. `packDay` (monthLayout.ts,
beside `packWeek`) fixes that by giving each block a `col`/`cols` share of the
column, which the view turns into inline `left: ${col/cols}%` and
`width: calc(${1/cols}% - 1px)`.

It groups blocks into **clusters** — maximal runs of overlap, chained: A over B
and B over C puts all three in one cluster even if A and C never meet. A cluster
ends at the first block starting when the column is completely empty again. Each
cluster is then divided by its **busiest moment**, not its member count: within a
cluster each block takes the leftmost column whose last occupant has already
ended, so in the A/B/C case above C reuses A's vacated column and the cluster is
two wide, not three. Blocks that merely touch (one ends exactly as the next
starts) don't overlap and share a column.

The sort in front of it is `packWeek`'s four keys — start, then longest, then
title, then id. As there, the point is a total order: without the last two,
equal-start events would swap columns between renders.

`packDay` also owns the clipping and the floors that decide a block *exists*: an
event with no `end` gets a nominal 30 minutes, and every block is floored at half
an hour, so a zero-length event is still visible and clickable rather than a 0px
line. `.calendar-week-draft` mirrors the resulting geometry (full width bar the
same 1px — a span being swept out overlaps nothing yet), because a drag preview
that doesn't match the block it produces is worse than no preview.
