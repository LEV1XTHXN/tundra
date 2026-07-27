# Calendar month view

The month grid (`src/calendar/CalendarView.tsx`, `MonthGrid`) is laid out like
Google Calendar's: timed events are unfilled `● 09:30 Title` rows, while all-day
events and multi-day periods are filled bars drawn as ONE continuous span across
the days they cover. That second part is why the grid isn't a plain 42-cell CSS
grid.

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

- `.calendar-week-cells` — the 7 day cells (number, hover actions, row list).
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
(`MONTH_HEAD_REM`, `MONTH_LANE_REM`, `MONTH_ROW_REM`, `MONTH_MORE_REM`,
`MONTH_WEEKDAY_REM`) and **must match** `.calendar-cell-head` /
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
- `.calendar-week-header > .calendar-week-gutter` clears its `border-right`. The
  header cell above the times is empty, so a rule there separates nothing and
  reads as a stub hanging off the grid's top edge. The *body* gutter keeps its
  rule — that one is the real divide.

Each label is pulled up half a line (`translateY(-0.5em)`) so it sits **on** its
hour's rule. The first one is `visibility: hidden`, as in Google Calendar — it has
no rule above it, only the grid's top edge, so it reads as a stray number rather
than a marker for a line. `visibility`, **not** `display: none`: the element still
has to hold its `HOUR_HEIGHT_REM`, or every label below it slides up an hour and
the gutter stops matching the day columns.

*Inside* the frame it is otherwise untouched by this layout: it keeps
`.calendar-event` / `.calendar-week-*` and its own hour grid. Only month mode uses
the row/bar classes above.
