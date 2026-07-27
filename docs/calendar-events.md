# Calendar events: the dialog, typed times, and repeats

How an event is *created and edited*, and what a repeating event actually is on
disk. The grids that draw the result are a separate note —
[`calendar-month-view.md`](calendar-month-view.md).

## The event dialog

`EventDialog` (`src/calendar/CalendarView.tsx`) is a two-column form, not a stack
of labelled rows:

```
┌───────────────────────────────────────────────┐
│ Add name                                      │  title = the dialog's heading
├──────────────────┬────────────────────────────┤
│                  │  [ 09:00 ]  –  [ 14:30 ]   │  two TimeFields
│    MiniMonth     │  ☐ All day                 │
│  (range select)  │  Colour  ● ● ● ● ● ● ● ● ⊘ │  TAG_PALETTE
│                  │  [ Repeat            ▾ ]   │
│                  │  Wednesday, Jul 15         │  what the highlight means
├──────────────────┴────────────────────────────┤
│ Delete                      Cancel   Create   │
└───────────────────────────────────────────────┘
```

Two rules make it work:

- **The date lives only in the month, the time only in the fields.** There is no
  second date control that could disagree with the highlight. The month is
  `MiniMonth` with the new `range` prop (highlight only — the clicks stay the
  dialog's, since "which end does this click set" is its gesture) and
  `showMarks={false}`, which skips the event-dot `calendar.range` query: it's a
  picker here, not a view of the vault, and the round-trip would happen on every
  open.
- **The two times can't cross.** On a single-day event, moving the start carries
  its duration along and moving the end pulls the start down with it, so the pair
  is never backwards and `save()` needs no validation branch.

The title input *is* the heading, so the accessible `DialogTitle` is `sr-only`
rather than drawn twice. A new event now defaults to **timed** (09:00, one hour)
rather than all-day — the dialog leads with its time fields, and opening with
both greyed out reads as broken.

## Creating from the week grid

Two drags, one per axis:

- **Down a day column** sweeps out hours (`SlotDrag`), snapped to 15 minutes, and
  opens the dialog on that timed span. A press that never moves is the same
  gesture degenerate: a one-hour block at the mark it landed on.
- **Across the day headers** sweeps out *days* and opens the dialog on an
  **all-day** event over them — headers name days, so there are no hours to
  drag. Both directions are normalised, the covered headers are highlighted
  (`.calendar-week-daycol-head.selecting`) while the sweep runs, and the span
  still carries the ordinary 09:00–10:00 defaults so unticking "All day" in the
  dialog lands on a sensible hour instead of midnight.

A plain click on a header deliberately does **nothing** — it never did, and a
stray click quietly creating an event would cost more than the gesture is worth.
`moved` (past `DRAG_THRESHOLD_PX`) is what separates the two.

Which column the pointer is over is read off the headers' own
`getBoundingClientRect`s rather than computed from the grid template: the hour
gutter makes the columns uneven, and a copy of the CSS maths would drift from it.
The headers are sized for the gesture — `min-height: 3.5rem`, with the two-letter
day name stacked over the date and centred.

## `TimeField`

`src/components/TimeField.tsx`. A text input plus a popover of every quarter-hour
mark; the value is minutes past midnight, with no date and no timezone, so
whoever owns the day combines the two.

Native `<input type="time">` is out for the same reason `DateTimePicker` avoids
`type="date"` (a different unstylable OS widget per platform), and the hour/minute
`Select` pair it replaces took four interactions to say 14:30.

`parseTimeInput(raw, current, timeFormat)` is exported and unit-tested apart from
React. It takes what people type:

| Typed | Read as |
| --- | --- |
| `9`, `09` | 09:00 |
| `930`, `9:30`, `9.30`, `9 30` | 09:30 |
| `0930` | 09:30 |
| `2350` | 23:50 |
| `2:30pm`, `230pm` | 14:30 |
| `2560`, `19pm`, `9x`, empty | refused → the field reverts |

A bare run of digits splits at the **last two**, which is what makes `930` half
past nine. `current` only matters in 12-hour mode, where a bare `9` is genuinely
ambiguous: it keeps whichever half of the day the field already shows, so nudging
9:00 → 9:30 doesn't need "am" retyped. Unparseable text reverts instead of
clearing, so the field always holds a real time and the dialog never handles a
null one.

The clock-format pattern itself is `clockPattern` in `src/i18n/dateLocale.ts` —
shared by the field, the month day rows, the week blocks and the drag draft, so
the app can't end up with four different renderings of the same time.

## Repeats

### The model

`Repeat` on `Event` (`crates/tundra-core/src/calendar/mod.rs`):

```rust
Repeat { unit: Day | Week | Year, interval: u32, until: Option<NaiveDate>, skip: Vec<NaiveDate> }
```

Daily/weekly/yearly are `interval: 1` of the matching unit; the dialog's "every N
days" is `Day` with `interval: N` — one shape rather than a "custom" variant with
its own expansion branch. `interval` is clamped to >= 1 on write, because 0 would
step nowhere and spin the expansion loop.

**One record is stored, however many occurrences it has.** `calendar.json` only
ever holds the series anchor; `events_in_range` expands it per query, which is
what makes an open-ended repeat finite. Each expanded clone is shifted by whole
days (so the clock time and a multi-day span carry over) and tagged with
`occurrence: Some(day)` — an annotation that is stripped again on the way in
(`normalize`) and never reaches the file.

Expansion starts at the first occurrence that can still *reach* the range — one
whose first day is at most the event's own span before it — rather than at the
anchor, so a daily event started years ago costs a division, not one iteration per
elapsed day. Yearly repeats count years and use `with_year`, which has no answer
for 29 February in a common year: that year gets **no** occurrence rather than
sliding to the 28th or the 1st.

### Consequences for the frontend

A range query now returns several events sharing one `id`. Anything keyed on
identity must use **`eventKey(ev)`** (`src/calendar/monthLayout.ts`), which pairs
the id with the occurrence day. `packWeek`/`packDay` are unaffected — they only
use `id` as a sort tiebreak.

### Editing an occurrence

Editing any occurrence edits the **whole series**. The dialog hands back the
instants of the day the user clicked, so `CalendarStore::update` re-anchors them
(`rebase_onto_series`): the clock time and duration are the user's, the start
*date* stays the stored one, shifted by however far the user moved this
occurrence's own date — which moves the entire series by the same amount. Writing
them back verbatim would drag the series forward to the clicked day and silently
drop every earlier occurrence.

Two corollaries, both deliberate:

- Moving the date clears `skip` — those days named occurrences of the old
  schedule and would otherwise hide unrelated ones.
- Clearing the repeat from an occurrence leaves a plain event on **that** day,
  which is the natural reading of "make this one a normal event".

### Deleting

Deleting an occurrence asks which one it means (`DeleteSeriesDialog`):

- **This day** → `delete_event_occurrence(id, date)`, which pushes the day onto
  `repeat.skip`; expansion stops producing it and the rest of the series stands.
- **Whole series** → the ordinary `delete_event(id)`.

Everything that isn't an expanded occurrence still deletes without a prompt, from
the dialog's Delete button and the grid's right-click menu alike — both route
through `CalendarView`'s one `requestDelete`.
