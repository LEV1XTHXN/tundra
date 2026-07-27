/**
 * Calendar view (Phase 3 step 2) — month/week grid over the vault's events and
 * note→date links. React renders and dispatches; ALL data + persistence go
 * through the `calendar`/`notes` services (never `@tauri-apps/api` here). Events
 * (incl. multi-day time periods) and notes linked to a date are shown per day;
 * events can be created/edited/deleted, notes linked/unlinked to a day, and a
 * linked note opened (which switches to the editor via `onOpenNote`).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  addDays,
  addMinutes,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Link2, Plus, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { calendar, notes } from "@/services";
import type { Event as CalEvent, NoteDate, NoteDateEntry, NoteSummary, Repeat } from "@/services";
import { useTheme } from "@/store/theme";
import { contrastText, TAG_PALETTE } from "@/store/tagColors";
import { useViewState } from "@/store/viewState";
import { clockPattern, formatCap, useDateLocale } from "@/i18n/dateLocale";
import { localizeError } from "@/i18n/errors";
import { ViewFrame } from "@/components/ViewFrame";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateTimePicker } from "@/components/DateTimePicker";
import { TimeField } from "@/components/TimeField";
import { Button } from "@/components/ui/button";
import { CalendarDayMenu, EventContextMenu } from "./CalendarContextMenu";
import type { CalendarMenuActions } from "./CalendarContextMenu";
import { MiniMonth } from "./MiniMonth";
import { eventKey, isSpanning, packDay, packWeek, toWeeks } from "./monthLayout";
import type { DaySegment } from "./monthLayout";

type Mode = "month" | "week";

/** Optional event colours. Reuses the app's shared TAG_PALETTE (tag chips,
 *  Kanban cards, folder properties, graph nodes) rather than keeping a sixth
 *  palette of its own. Events persist the chosen HEX, not an index, so an event
 *  coloured under an older palette keeps the exact hue it was given — it simply
 *  can't be picked again once that hue leaves TAG_PALETTE. */
const COLORS = TAG_PALETTE;

/** Weeks start Monday throughout the calendar (date-fns: 0 = Sunday, 1 = Monday). */
const WEEK_STARTS_ON = 1;

/** Hour rows the week view's time grid renders, midnight to 11pm. */
const HOURS = Array.from({ length: 24 }, (_, i) => i);
/** Must match `--calendar-hour-height` in index.css — kept as one number so the
 * hour-click and event-position math never drifts from the actual row height. */
const HOUR_HEIGHT_REM = 3.5;
/** The grain every time the hour grid produces is rounded to — a click or a
 * drag lands on :00/:15/:30/:45. Deliberately NOT drawn: the grid keeps one
 * rule per hour, and the quarter-hours exist only in the maths. */
const SNAP_MINUTES = 15;
/** A default one-hour block, for the two gestures that name a start but no end:
 * a plain click in the grid, and the day menu's "New event" over an hour. */
const DEFAULT_EVENT_MINUTES = 60;
/** How far the pointer must travel before a press counts as a drag rather than
 * a click. Without it, the shake in a normal click would sweep out a span. */
const DRAG_THRESHOLD_PX = 3;
/** Under this, a week block puts its time BESIDE the title instead of under it.
 * Purely a question of what fits: at `HOUR_HEIGHT_REM` a 45min block is 42px,
 * which clears two 15px lines plus padding — a 30min block's 28px does not. */
const SHORT_EVENT_MINUTES = 45;

/** One stacked lane of all-day bars, in rem — `.calendar-allday-bar`'s height
 * plus its margin. Shared: BOTH grids draw the same bar (month inside a week
 * row, week inside its header strip), so both offset their contents by it. */
const ALLDAY_LANE_REM = 1.4;

/** How many lanes of all-day bars the WEEK strip shows before the rest collapse
 * into a per-day "+N more". Unlike a month cell there's nothing to measure —
 * the strip lives in a sticky header, which would push the hour grid off screen
 * if it grew freely — so the cap is a flat number. */
const WEEK_ALLDAY_LANES = 3;

/** How much of a day column's width the timed blocks fill, as a percentage. The
 * remaining sliver on the right is deliberate empty column: it keeps a block
 * visibly detached from the next day's rule, and leaves bare grid to click or
 * drag on beside an event rather than only above and below it. Overlapping
 * blocks split THIS width between them, not the full column. */
const WEEK_EVENT_WIDTH_PCT = 80;

/** Month-cell metrics, in rem. These MUST match the corresponding heights in
 * index.css (`.calendar-cell-head`, `.calendar-event-row`, `.calendar-more`):
 * the grid computes how many rows fit in a cell from them, so a drift here shows
 * up as a wrong "+N more" count. Same contract as `HOUR_HEIGHT_REM` above. */
const MONTH_HEAD_REM = 1.75;
const MONTH_ROW_REM = 1.35;
const MONTH_MORE_REM = 1.2;
/** The weekday label ("MON") that heads each cell of the FIRST week row only —
 * extra head height that row alone pays for. */
const MONTH_WEEKDAY_REM = 1.1;

/** A day's vault-relative key (`yyyy-MM-dd`), matching the `NoteDate` date form. */
const dayKey = (d: Date) => format(d, "yyyy-MM-dd");

/** A dialog request: create/edit an event, or link a note — to a specific day.
 * `range` pre-fills a NEW event's times: the hour a menu was opened over, or the
 * span a drag swept out in the week grid. Absent means all-day. */
type DialogState =
  | { kind: "event"; day: Date; event?: CalEvent; range?: TimeRange; allDay?: boolean }
  | { kind: "linkNote"; day: Date }
  | null;

type TimeRange = { start: Date; end: Date };

/** A range on `day` from minute offsets past midnight — the form both the hour
 * grid's drag and its keyboard slot activation produce. */
const rangeOnDay = (day: Date, startMin: number, endMin: number): TimeRange => ({
  start: addMinutes(startOfDay(day), startMin),
  end: addMinutes(startOfDay(day), endMin),
});

export function CalendarView({
  onOpenNote,
  onError,
}: {
  onOpenNote: (id: string) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [mode, setMode] = useState<Mode>("month");
  // A date inside the currently-shown period; navigation moves it by month/week.
  // Shared state (`useViewState`) rather than local, because the shell sidebar's
  // mini month drives the same cursor from outside this view. Jumps to the Home
  // widget's clicked day when set (consumed once — see useViewState's
  // calendarTarget doc comment).
  const cursor = useViewState((s) => s.calendarCursor);
  const setCursor = useViewState((s) => s.setCalendarCursor);
  useEffect(() => {
    const target = useViewState.getState().calendarTarget;
    if (!target) return;
    setCursor(target);
    useViewState.getState().setCalendarTarget(null);
  }, [setCursor]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [noteDates, setNoteDates] = useState<NoteDateEntry[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);

  // The visible grid: whole weeks covering the month, or a single week.
  const days = useMemo(() => {
    if (mode === "week") {
      return eachDayOfInterval({
        start: startOfWeek(cursor, { weekStartsOn: WEEK_STARTS_ON }),
        end: endOfWeek(cursor, { weekStartsOn: WEEK_STARTS_ON }),
      });
    }
    return eachDayOfInterval({
      start: startOfWeek(startOfMonth(cursor), { weekStartsOn: WEEK_STARTS_ON }),
      end: endOfWeek(endOfMonth(cursor), { weekStartsOn: WEEK_STARTS_ON }),
    });
  }, [mode, cursor]);

  const gridStart = days[0];
  const gridEnd = days[days.length - 1];

  const load = useCallback(() => {
    calendar
      .range(dayKey(gridStart), dayKey(gridEnd))
      .then((r) => {
        setEvents(r.events);
        setNoteDates(r.note_dates);
      })
      .catch((e) => onError(localizeError(e, t)));
  }, [gridStart, gridEnd, onError]);

  useEffect(() => load(), [load]);

  // Bucket events + note-date links by day key for O(1) per-cell lookup. An event
  // is placed on every day of its (inclusive) span, so multi-day periods render
  // across the cells they cover.
  const byDay = useMemo(() => {
    const map = new Map<string, { events: CalEvent[]; notes: NoteDateEntry[] }>();
    const bucket = (key: string) => {
      let b = map.get(key);
      if (!b) map.set(key, (b = { events: [], notes: [] }));
      return b;
    };
    for (const ev of events) {
      const start = startOfDay(parseISO(ev.start));
      const rawEnd = ev.end ? startOfDay(parseISO(ev.end)) : start;
      const [from, to] = rawEnd < start ? [rawEnd, start] : [start, rawEnd];
      for (const d of eachDayOfInterval({ start: from, end: to })) {
        bucket(dayKey(d)).events.push(ev);
      }
    }
    for (const nd of noteDates) bucket(nd.date).notes.push(nd);
    return map;
  }, [events, noteDates]);

  const shift = (delta: number) =>
    setCursor(mode === "week" ? addWeeks(cursor, delta) : addMonths(cursor, delta));

  const heading =
    mode === "week"
      ? `${formatCap(gridStart, "MMM d", dateLocale)} – ${formatCap(gridEnd, "MMM d, yyyy", dateLocale)}`
      // `LLLL`, not `MMMM`: the standalone (nominative) month name. Russian's
      // `MMMM` is the genitive form meant to sit next to a day number — "Июля
      // 2026" instead of "Июль 2026".
      : formatCap(cursor, "LLLL yyyy", dateLocale);

  const unlinkNote = useCallback(
    (nd: NoteDateEntry) => {
      const date: NoteDate = { date: nd.date, event_id: nd.event_id };
      calendar.removeNoteDate(nd.note_id, date).then(load).catch((e) => onError(localizeError(e, t)));
    },
    [load, onError, t],
  );

  // Deleting the whole record: a plain event, or every occurrence of a series.
  const deleteEvent = useCallback(
    (ev: CalEvent) => {
      calendar.deleteEvent(ev.id).then(load).catch((e) => onError(localizeError(e, t)));
    },
    [load, onError, t],
  );

  // One occurrence of a repeating event has two possible meanings for "delete",
  // so it — and only it — asks first. Everything else goes straight through, as
  // it always has.
  const [confirmDelete, setConfirmDelete] = useState<CalEvent | null>(null);
  const requestDelete = useCallback(
    (ev: CalEvent) => {
      if (ev.repeat && ev.occurrence) setConfirmDelete(ev);
      else deleteEvent(ev);
    },
    [deleteEvent],
  );
  const deleteOccurrence = useCallback(
    (ev: CalEvent) => {
      if (!ev.occurrence) return;
      calendar
        .deleteEventOccurrence(ev.id, ev.occurrence)
        .then(load)
        .catch((e) => onError(localizeError(e, t)));
    },
    [load, onError, t],
  );

  // Everything the right-click menus can dispatch. The same create/edit paths
  // the buttons use, so a menu action and a click land in the same dialog.
  const menuActions: CalendarMenuActions = useMemo(
    () => ({
      // The menu names an hour at most; a bare day (month cell, week header)
      // still means all-day, i.e. no range at all.
      onNewEvent: (day, hour) =>
        setDialog({
          kind: "event",
          day,
          range:
            hour === undefined
              ? undefined
              : rangeOnDay(day, hour * 60, hour * 60 + DEFAULT_EVENT_MINUTES),
        }),
      onLinkNote: (day) => setDialog({ kind: "linkNote", day }),
      onEditEvent: (day, event) => setDialog({ kind: "event", day, event }),
      onDeleteEvent: requestDelete,
    }),
    [requestDelete],
  );

  // Clicking a day in the month grid drills into it: the week view, on that
  // day's week. The cursor doubles as "which week", so moving it and flipping
  // the mode is the whole operation.
  const openDayInWeek = useCallback(
    (day: Date) => {
      setCursor(day);
      setMode("week");
    },
    [setCursor],
  );

  const calendarActions = (
    <div className="calendar-controls">
      <div className="calendar-modes">
        <button className={mode === "month" ? "active" : ""} onClick={() => setMode("month")}>
          Month
        </button>
        <button className={mode === "week" ? "active" : ""} onClick={() => setMode("week")}>
          Week
        </button>
      </div>
      <button className="calendar-nav" onClick={() => shift(-1)} aria-label="Previous">
        ‹
      </button>
      <button className="calendar-nav" onClick={() => setCursor(new Date())}>
        Today
      </button>
      <button className="calendar-nav" onClick={() => shift(1)} aria-label="Next">
        ›
      </button>
      <Button size="sm" onClick={() => setDialog({ kind: "event", day: cursor })}>
        <Plus className="h-4 w-4" /> Event
      </Button>
    </div>
  );

  return (
    <ViewFrame title={heading} actions={calendarActions} fullBleed>
    <div className="calendar">
      {mode === "month" && (
        <MonthGrid
          days={days}
          cursor={cursor}
          events={events}
          byDay={byDay}
          onEventClick={(day, event) => setDialog({ kind: "event", day, event })}
          onDayClick={openDayInWeek}
          onOpenNote={onOpenNote}
          onUnlinkNote={unlinkNote}
          actions={menuActions}
        />
      )}

      {mode === "week" && (
        <WeekTimeGrid
          days={days}
          events={events}
          byDay={byDay}
          onSlotRange={(day, startMin, endMin) =>
            setDialog({ kind: "event", day, range: rangeOnDay(day, startMin, endMin) })
          }
          // A sweep across the day headers names days, not hours: an all-day
          // event over the span. The times it carries are the ordinary defaults,
          // so unticking "All day" in the dialog lands on a sensible hour rather
          // than on midnight.
          onDaySpan={(from, to) =>
            setDialog({
              kind: "event",
              day: from,
              allDay: true,
              range: {
                start: addMinutes(startOfDay(from), DEFAULT_EVENT_HOUR * 60),
                end: addMinutes(startOfDay(to), DEFAULT_EVENT_HOUR * 60 + DEFAULT_EVENT_MINUTES),
              },
            })
          }
          onEventClick={(day, event) => setDialog({ kind: "event", day, event })}
          onOpenNote={onOpenNote}
          onUnlinkNote={unlinkNote}
          onLinkNote={(day) => setDialog({ kind: "linkNote", day })}
          actions={menuActions}
        />
      )}

      {dialog?.kind === "event" && (
        <EventDialog
          day={dialog.day}
          event={dialog.event}
          range={dialog.range}
          allDay={dialog.allDay}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            load();
          }}
          // Delete leaves the dialog and joins the grid's own delete path, so
          // an occurrence gets the same "this day or all of them?" question
          // wherever it was triggered from.
          onDelete={(ev) => {
            setDialog(null);
            requestDelete(ev);
          }}
          onError={onError}
        />
      )}
      {confirmDelete && (
        <DeleteSeriesDialog
          event={confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onDeleteDay={() => {
            deleteOccurrence(confirmDelete);
            setConfirmDelete(null);
          }}
          onDeleteSeries={() => {
            deleteEvent(confirmDelete);
            setConfirmDelete(null);
          }}
        />
      )}
      {dialog?.kind === "linkNote" && (
        <LinkNoteDialog
          day={dialog.day}
          onClose={() => setDialog(null)}
          onLinked={() => {
            setDialog(null);
            load();
          }}
          onError={onError}
        />
      )}
    </div>
    </ViewFrame>
  );
}

/** One thing listed inside a day cell, under that day's all-day bars: a timed
 * event or a note linked to the day. Both render as the same `● time title`
 * row shape, so a cell's contents read as one list. */
type DayItem =
  | { kind: "event"; event: CalEvent }
  | { kind: "note"; note: NoteDateEntry };

const itemKey = (item: DayItem) =>
  item.kind === "event"
    ? `e:${eventKey(item.event)}`
    : `n:${item.note.note_id}:${item.note.event_id ?? ""}`;

/**
 * Month mode's grid: a weekday header over one row per week. Within a week row,
 * all-day events (and multi-day periods) are drawn as CONTINUOUS bars in an
 * overlay grid — `packWeek` gives each its column span and lane — while timed
 * events and note links list underneath as rows inside their own day cell.
 *
 * Cells are fixed-height, so whatever doesn't fit collapses into a "+N more"
 * button that opens the full day in a popover. How much fits is computed from
 * the measured row height and the MONTH_*_REM metrics, rather than guessed.
 *
 * Creating and deleting live in the right-click menus (`actions`) — cells carry
 * no hover chrome, so a dense month stays as calm as the reference design.
 *
 * Left-clicking a cell's empty space drills into that day (`onDayClick`); the
 * buttons inside it keep their own meaning — see `cellClick`.
 */
function MonthGrid({
  days,
  cursor,
  events,
  byDay,
  onEventClick,
  onDayClick,
  onOpenNote,
  onUnlinkNote,
  actions,
}: {
  days: Date[];
  cursor: Date;
  events: CalEvent[];
  byDay: Map<string, { events: CalEvent[]; notes: NoteDateEntry[] }>;
  onEventClick: (day: Date, event: CalEvent) => void;
  onDayClick: (day: Date) => void;
  onOpenNote: (id: string) => void;
  onUnlinkNote: (nd: NoteDateEntry) => void;
  actions: CalendarMenuActions;
}) {
  const dateLocale = useDateLocale();
  const weeks = useMemo(() => toWeeks(days), [days]);
  const [peekDay, setPeekDay] = useState<string | null>(null);

  // How tall one week row actually is, in px — the input for "how many rows fit
  // in a cell". All rows share the grid's height, so one measurement covers
  // every cell; `null` means "not measured yet", and until then nothing is
  // collapsed (a first paint that hides rows and immediately shows them again
  // reads as a flicker).
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [rowHeight, setRowHeight] = useState<number | null>(null);
  const weekCountRef = useRef(weeks.length);
  weekCountRef.current = weeks.length;
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setRowHeight(el.clientHeight / Math.max(1, weekCountRef.current));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el) setRowHeight(el.clientHeight / Math.max(1, weeks.length));
  }, [weeks.length]);

  const rem = useMemo(
    () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
    [],
  );

  // `EEEEEE` — the two-letter short form — in every language: "Mo Tu We",
  // "Пн Вт Ср", "Mo Di Mi". (`EEE` is three letters, and picks up a trailing dot
  // in German: "Mo.".) Same token the mini month uses, so the two agree.
  const weekdayLabels = useMemo(
    () => Array.from({ length: 7 }, (_, i) => format(addDays(days[0], i), "EEEEEE", { locale: dateLocale })),
    [days, dateLocale],
  );

  // A cell is one big click target, but it also CONTAINS buttons (event rows,
  // the note open/unlink pair, "+N more"). Their clicks bubble here, so the
  // drill-in only fires for clicks that didn't land on one — otherwise opening
  // an event would silently change the view underneath its dialog. The all-day
  // bars need no guard: they live in the overlay lane, a sibling of the cells.
  const cellClick = (day: Date) => (e: ReactMouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    onDayClick(day);
  };

  return (
    <div className="calendar-month">
      <div className="calendar-month-body" ref={bodyRef}>
        {weeks.map((week, weekIndex) => {
          const bars = packWeek(week, events);
          const laneCount = bars.reduce((max, b) => Math.max(max, b.lane + 1), 0);
          // The weekday names head the first row's cells (no separate strip), so
          // that row's head is taller — and it, not the constant, is what the
          // capacity maths and the bar overlay's offset must use.
          const headRem = weekIndex === 0 ? MONTH_HEAD_REM + MONTH_WEEKDAY_REM : MONTH_HEAD_REM;
          // Lanes eat the same vertical space the rows want; cap them so a day
          // stacked with periods still has room for a "+N more".
          const laneLimit =
            rowHeight === null
              ? laneCount
              : Math.max(
                  0,
                  Math.floor((rowHeight / rem - headRem - MONTH_MORE_REM) / ALLDAY_LANE_REM),
                );
          const lanes = Math.min(laneCount, laneLimit);
          const rowCapacity =
            rowHeight === null
              ? Number.POSITIVE_INFINITY
              : Math.max(
                  0,
                  Math.floor((rowHeight / rem - headRem - lanes * ALLDAY_LANE_REM) / MONTH_ROW_REM),
                );

          return (
            <div className="calendar-week-row" key={dayKey(week[0])}>
              <div className="calendar-week-cells">
                {week.map((day, col) => {
                  const key = dayKey(day);
                  const cell = byDay.get(key);
                  const items = dayItems(cell);
                  // Bars whose lane got cut off still belong to this day — they
                  // count towards the overflow instead of vanishing.
                  const hiddenBars = bars.filter(
                    (b) => b.lane >= lanes && b.colStart <= col && col < b.colStart + b.span,
                  );
                  const total = items.length + hiddenBars.length;
                  const overflows = total > rowCapacity;
                  const shown = overflows ? Math.max(rowCapacity - 1, 0) : items.length;
                  const hidden = total - shown;

                  return (
                    // The cell's own menu creates on this day; the event rows
                    // inside carry their own and stop the event, so only the
                    // innermost one opens.
                    <ContextMenu key={key}>
                      <ContextMenuTrigger asChild>
                        <div
                          className={`calendar-cell${isSameMonth(day, cursor) ? "" : " dim"}${
                            isToday(day) ? " today" : ""
                          }`}
                          onClick={cellClick(day)}
                        >
                          <div
                            className={`calendar-cell-head${weekIndex === 0 ? " with-weekday" : ""}`}
                          >
                            {weekIndex === 0 && (
                              <span className="calendar-weekday-label">{weekdayLabels[col]}</span>
                            )}
                            <span className="calendar-daynum">
                              {format(day, day.getDate() === 1 ? "d MMM" : "d", { locale: dateLocale })}
                            </span>
                          </div>
                          <div
                            className="calendar-cell-body"
                            style={{ paddingTop: `${lanes * ALLDAY_LANE_REM}rem` }}
                          >
                            {items.slice(0, shown).map((item) => (
                              <DayItemRow
                                key={itemKey(item)}
                                item={item}
                                day={day}
                                onEventClick={onEventClick}
                                onOpenNote={onOpenNote}
                                onUnlinkNote={onUnlinkNote}
                                actions={actions}
                              />
                            ))}
                            {hidden > 0 && (
                              <Popover
                                open={peekDay === key}
                                onOpenChange={(open) => setPeekDay(open ? key : null)}
                              >
                                <PopoverTrigger asChild>
                                  <button className="calendar-more">{`+${hidden} more`}</button>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="calendar-day-popover">
                                  <div className="calendar-day-popover-head">
                                    {formatCap(day, "EEEE, MMM d", dateLocale)}
                                  </div>
                                  <div className="calendar-day-popover-list">
                                    {bars
                                      .filter((b) => b.colStart <= col && col < b.colStart + b.span)
                                      .map((b) => (
                                        <EventContextMenu
                                          key={eventKey(b.event)}
                                          day={day}
                                          event={b.event}
                                          actions={actions}
                                        >
                                          <button
                                            className="calendar-allday-bar"
                                            style={barStyle(b.event.color)}
                                            onClick={() => {
                                              setPeekDay(null);
                                              onEventClick(day, b.event);
                                            }}
                                          >
                                            {b.event.title || "(untitled)"}
                                          </button>
                                        </EventContextMenu>
                                      ))}
                                    {items.map((item) => (
                                      <DayItemRow
                                        key={itemKey(item)}
                                        item={item}
                                        day={day}
                                        onEventClick={(d, ev) => {
                                          setPeekDay(null);
                                          onEventClick(d, ev);
                                        }}
                                        onOpenNote={(id) => {
                                          setPeekDay(null);
                                          onOpenNote(id);
                                        }}
                                        onUnlinkNote={onUnlinkNote}
                                        actions={actions}
                                      />
                                    ))}
                                  </div>
                                </PopoverContent>
                              </Popover>
                            )}
                          </div>
                        </div>
                      </ContextMenuTrigger>
                      <CalendarDayMenu day={day} actions={actions} />
                    </ContextMenu>
                  );
                })}
              </div>

              {lanes > 0 && (
                <div
                  className="calendar-alldaylane"
                  style={{
                    top: `${headRem}rem`,
                    gridTemplateRows: `repeat(${lanes}, ${ALLDAY_LANE_REM}rem)`,
                  }}
                >
                  {bars
                    .filter((b) => b.lane < lanes)
                    .map((b) => (
                      <EventContextMenu
                        key={eventKey(b.event)}
                        day={week[b.colStart]}
                        event={b.event}
                        actions={actions}
                      >
                        <button
                          className={`calendar-allday-bar${b.continuesLeft ? " continues-left" : ""}${
                            b.continuesRight ? " continues-right" : ""
                          }`}
                          style={{
                            gridColumn: `${b.colStart + 1} / span ${b.span}`,
                            gridRow: b.lane + 1,
                            ...barStyle(b.event.color),
                          }}
                          title={b.event.title}
                          onClick={() => onEventClick(week[b.colStart], b.event)}
                        >
                          {b.event.title || "(untitled)"}
                        </button>
                      </EventContextMenu>
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A day's non-bar contents, in reading order: timed events by clock time, then
 * the notes linked to the day. */
function dayItems(cell: { events: CalEvent[]; notes: NoteDateEntry[] } | undefined): DayItem[] {
  if (!cell) return [];
  const timed = cell.events
    .filter((ev) => !isSpanning(ev))
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  return [
    ...timed.map((event): DayItem => ({ kind: "event", event })),
    ...cell.notes.map((note): DayItem => ({ kind: "note", note })),
  ];
}

/** An event's bar/dot colour: its own, or the theme accent when it has none.
 *  The label can't be a fixed white — TAG_PALETTE spans a yellow that white
 *  disappears on — so it's picked per swatch by the same `contrastText` helper
 *  the tag chips use. */
const barStyle = (color: string | null | undefined) =>
  color ? { background: color, color: contrastText(color) } : undefined;

/** One row in a day cell: `● 09:30 Zoom Sync` for a timed event, or the same
 * shape with a link glyph for a note tied to the day. */
function DayItemRow({
  item,
  day,
  onEventClick,
  onOpenNote,
  onUnlinkNote,
  actions,
}: {
  item: DayItem;
  day: Date;
  onEventClick: (day: Date, event: CalEvent) => void;
  onOpenNote: (id: string) => void;
  onUnlinkNote: (nd: NoteDateEntry) => void;
  actions: CalendarMenuActions;
}) {
  const dateLocale = useDateLocale();
  const timeFormat = useTheme((s) => s.timeFormat);

  if (item.kind === "event") {
    const ev = item.event;
    return (
      <EventContextMenu day={day} event={ev} actions={actions}>
        <button
          className="calendar-event-row"
          title={ev.title}
          onClick={() => onEventClick(day, ev)}
        >
          <span className="calendar-event-dot" style={ev.color ? { background: ev.color } : undefined} />
          <span className="calendar-event-time">
            {format(parseISO(ev.start), clockPattern(timeFormat), { locale: dateLocale })}
          </span>
          <span className="calendar-event-title">{ev.title || "(untitled)"}</span>
        </button>
      </EventContextMenu>
    );
  }

  const nd = item.note;
  return (
    <span className="calendar-event-row note">
      <button
        className="calendar-event-open"
        title={`Open "${nd.title}"`}
        onClick={() => onOpenNote(nd.note_id)}
      >
        <Link2 className="calendar-event-icon h-3 w-3" />
        <span className="calendar-event-title">{nd.title || "Untitled"}</span>
      </button>
      <button
        className="calendar-event-unlink"
        title="Unlink"
        aria-label="Unlink note"
        onClick={() => onUnlinkNote(nd)}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

/** Where a pointer sits in a day column, as minutes past that day's midnight,
 * snapped DOWN to the enclosing `SNAP_MINUTES` slot and clamped to the day.
 * The column's rect is read live by every caller, so a grid scrolled mid-drag
 * still measures from where the column actually is. */
function snappedMinutesAt(col: HTMLElement, clientY: number, rem: number) {
  const offset = clientY - col.getBoundingClientRect().top;
  const minutes = (offset / (HOUR_HEIGHT_REM * rem)) * 60;
  const clamped = Math.min(HOURS.length * 60 - SNAP_MINUTES, Math.max(0, minutes));
  return Math.floor(clamped / SNAP_MINUTES) * SNAP_MINUTES;
}

/** A live click-and-drag over one day column. `col` is kept so each move can
 * re-measure it; `anchor`/`current` are snapped minute offsets (either may be
 * the later one — dragging upward is allowed); `moved` separates a real drag
 * from a plain click, which means a different default length. */
type SlotDrag = {
  key: string;
  day: Date;
  col: HTMLElement;
  startY: number;
  anchor: number;
  current: number;
  moved: boolean;
};

/** The minute span a drag covers: ordered, and inclusive of the slot the
 * pointer is in, so the shortest drag is one `SNAP_MINUTES` block. A plain
 * click names no length at all, so it gets the standard hour. */
function dragRange(drag: SlotDrag) {
  const from = Math.min(drag.anchor, drag.current);
  const to = drag.moved
    ? Math.max(drag.anchor, drag.current) + SNAP_MINUTES
    : from + DEFAULT_EVENT_MINUTES;
  return { from, to: Math.min(to, HOURS.length * 60) };
}

/** Week mode's hour-by-hour view: a gutter of hour labels, one scrollable
 * column per day, and timed events positioned/sized by their clock time.
 *
 * Empty grid space is a create surface: press and drag to sweep out a span —
 * previewed as you go, snapped to `SNAP_MINUTES` — and release to open the
 * event dialog pre-filled with it. A press with no drag is the same gesture
 * degenerate, and yields a one-hour block at the snapped mark it landed on.
 *
 * Above the grid sits the all-day strip, laid out by the SAME `packWeek` the
 * month grid uses: every spanning event (all-day, or running across a day
 * boundary) is one continuous lane-packed bar across the days it covers, rather
 * than a chip per column or a block filling each day's hours. The strip is
 * inside the sticky header, so its lanes are capped (`WEEK_ALLDAY_LANES`) and
 * the remainder collapses into a per-day "+N more". */
function WeekTimeGrid({
  days,
  events,
  byDay,
  onSlotRange,
  onDaySpan,
  onEventClick,
  onOpenNote,
  onUnlinkNote,
  onLinkNote,
  actions,
}: {
  days: Date[];
  events: CalEvent[];
  byDay: Map<string, { events: CalEvent[]; notes: NoteDateEntry[] }>;
  onSlotRange: (day: Date, startMinutes: number, endMinutes: number) => void;
  onDaySpan: (from: Date, to: Date) => void;
  onEventClick: (day: Date, event: CalEvent) => void;
  onOpenNote: (id: string) => void;
  onUnlinkNote: (nd: NoteDateEntry) => void;
  onLinkNote: (day: Date) => void;
  actions: CalendarMenuActions;
}) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const timeFormat = useTheme((s) => s.timeFormat);
  const hourLabel = (h: number) =>
    format(new Date(2000, 0, 1, h), timeFormat === "24h" ? "HH:mm" : "h a", { locale: dateLocale });

  // The hour the last right-click landed on, so a menu opened over the grid
  // creates at that time rather than all-day. One menu is open at a time, so a
  // single value covers all seven columns. Set in the CAPTURE phase, which is
  // guaranteed to run before Radix's trigger opens the menu.
  const [ctxHour, setCtxHour] = useState<number | undefined>(undefined);
  const rem = useMemo(
    () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
    [],
  );
  const hourAt = (e: ReactMouseEvent<HTMLDivElement>) => {
    setCtxHour(Math.floor(snappedMinutesAt(e.currentTarget, e.clientY, rem) / 60));
  };

  // The drag in progress, if any. Moves and the release are tracked on the
  // WINDOW, not the column: a gesture that runs off the grid (or off the app)
  // still ends cleanly, which is the same reason FolderTable's column resize
  // listens there.
  const [drag, setDrag] = useState<SlotDrag | null>(null);
  const startDrag = (day: Date) => (e: ReactMouseEvent<HTMLDivElement>) => {
    // Left button only — right-click belongs to the context menu — and never on
    // top of an existing event, which has its own click and menu.
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".calendar-week-event")) return;
    e.preventDefault(); // no text selection / native drag while sweeping
    const at = snappedMinutesAt(e.currentTarget, e.clientY, rem);
    setDrag({
      key: dayKey(day),
      day,
      col: e.currentTarget,
      startY: e.clientY,
      anchor: at,
      current: at,
      moved: false,
    });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const at = snappedMinutesAt(drag.col, e.clientY, rem);
      const moved = drag.moved || Math.abs(e.clientY - drag.startY) > DRAG_THRESHOLD_PX;
      // Re-render per quarter-hour, not per pixel: below the threshold and
      // inside the same slot there is nothing new to draw.
      if (at === drag.current && moved === drag.moved) return;
      setDrag({ ...drag, current: at, moved });
    };
    const onUp = () => {
      const { from, to } = dragRange(drag);
      setDrag(null);
      onSlotRange(drag.day, from, to);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.classList.add("calendar-dragging");
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("calendar-dragging");
    };
  }, [drag, rem, onSlotRange]);

  // The horizontal twin of the hour drag above: a sweep across the day headers
  // picks out a run of DAYS. `anchor`/`current` are column indices (either may
  // be the later one — sweeping right to left is allowed), and `moved` keeps a
  // plain click from meaning anything, so clicking a day header still does
  // nothing rather than silently creating an event.
  const headRowRef = useRef<HTMLDivElement | null>(null);
  const [daySweep, setDaySweep] = useState<{ anchor: number; current: number; startX: number; moved: boolean } | null>(null);

  // Which column an x-coordinate is over, read off the headers' own rects rather
  // than computed from the grid template — the gutter makes the columns uneven,
  // and a measurement can't drift from the CSS the way a copy of it would.
  const columnAt = useCallback((clientX: number) => {
    const heads = headRowRef.current?.querySelectorAll<HTMLElement>(".calendar-week-daycol-head");
    if (!heads?.length) return 0;
    for (let i = 0; i < heads.length; i++) {
      if (clientX < heads[i].getBoundingClientRect().right) return i;
    }
    return heads.length - 1;
  }, []);

  const startDaySweep = (col: number) => (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDaySweep({ anchor: col, current: col, startX: e.clientX, moved: false });
  };

  useEffect(() => {
    if (!daySweep) return;
    const onMove = (e: MouseEvent) => {
      const col = columnAt(e.clientX);
      const moved = daySweep.moved || Math.abs(e.clientX - daySweep.startX) > DRAG_THRESHOLD_PX;
      if (col === daySweep.current && moved === daySweep.moved) return;
      setDaySweep({ ...daySweep, current: col, moved });
    };
    const onUp = () => {
      const { anchor, current, moved } = daySweep;
      setDaySweep(null);
      if (moved) onDaySpan(days[Math.min(anchor, current)], days[Math.max(anchor, current)]);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.classList.add("calendar-dragging");
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("calendar-dragging");
    };
  }, [daySweep, columnAt, days, onDaySpan]);

  const sweptDays = daySweep?.moved
    ? { from: Math.min(daySweep.anchor, daySweep.current), to: Math.max(daySweep.anchor, daySweep.current) }
    : null;

  // The all-day strip: one row of lane-packed bars across the whole week.
  const bars = useMemo(() => packWeek(days, events), [days, events]);
  const laneCount = bars.reduce((max, b) => Math.max(max, b.lane + 1), 0);
  const lanes = Math.min(laneCount, WEEK_ALLDAY_LANES);
  // Which day's "+N more" popover is open (one at a time), by day key.
  const [peekDay, setPeekDay] = useState<string | null>(null);

  return (
    <div className="calendar-week">
      <div className="calendar-week-header">
        <div className="calendar-week-daylabels" ref={headRowRef}>
          <div className="calendar-week-gutter" />
          {days.map((day, col) => (
            // The header's menu creates an all-day event on this day (no `hour`).
            <ContextMenu key={dayKey(day)}>
              <ContextMenuTrigger asChild>
                <div
                  className={`calendar-week-daycol-head${isToday(day) ? " today" : ""}${
                    sweptDays && sweptDays.from <= col && col <= sweptDays.to ? " selecting" : ""
                  }`}
                  onMouseDown={startDaySweep(col)}
                >
                  <div className="calendar-week-daylabel">
                    {/* `EEEEEE` — the same two-letter short form the month grid
                        uses, in every language ("Mo", "Пн", "Di"). */}
                    <span className="calendar-week-dayname">
                      {format(day, "EEEEEE", { locale: dateLocale })}
                    </span>
                    <span className="calendar-daynum">{format(day, "d")}</span>
                  </div>
                </div>
              </ContextMenuTrigger>
              <CalendarDayMenu day={day} actions={actions} />
            </ContextMenu>
          ))}
        </div>

        <div className="calendar-week-alldays">
          <div className="calendar-week-gutter" />
          {days.map((day, col) => {
            const key = dayKey(day);
            const cell = byDay.get(key);
            const dayBars = bars.filter((b) => b.colStart <= col && col < b.colStart + b.span);
            // Bars whose lane got cut off still belong to this day — they
            // collapse into its "+N more" instead of vanishing.
            const hidden = dayBars.filter((b) => b.lane >= lanes).length;
            return (
              <ContextMenu key={key}>
                <ContextMenuTrigger asChild>
                  <div
                    className="calendar-week-allday"
                    // Reserve the lane overlay's height: the bars are absolutely
                    // positioned over this row, so the notes below have to be
                    // pushed clear of them. The 0.15rem is the overlay's own top
                    // offset — inline padding replaces the stylesheet's, so it
                    // has to be carried here rather than left to the shorthand.
                    style={{ paddingTop: `calc(0.15rem + ${lanes * ALLDAY_LANE_REM}rem)` }}
                  >
                    {hidden > 0 && (
                      <Popover
                        open={peekDay === key}
                        onOpenChange={(open) => setPeekDay(open ? key : null)}
                      >
                        <PopoverTrigger asChild>
                          <button className="calendar-more">{`+${hidden} more`}</button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="calendar-day-popover">
                          <div className="calendar-day-popover-head">
                            {formatCap(day, "EEEE, MMM d", dateLocale)}
                          </div>
                          {/* Every bar covering the day, not just the hidden
                              ones — the day's timed events are already visible
                              in the grid below, so bars are all there is to
                              collapse, and listing them all keeps the popover a
                              complete picture rather than a remainder. */}
                          <div className="calendar-day-popover-list">
                            {dayBars.map((b) => (
                              <EventContextMenu
                                key={eventKey(b.event)}
                                day={day}
                                event={b.event}
                                actions={actions}
                              >
                                <button
                                  className="calendar-allday-bar"
                                  style={barStyle(b.event.color)}
                                  onClick={() => {
                                    setPeekDay(null);
                                    onEventClick(day, b.event);
                                  }}
                                >
                                  {b.event.title || "(untitled)"}
                                </button>
                              </EventContextMenu>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                    {cell?.notes.map((nd) => (
                      <span key={`${nd.note_id}:${nd.event_id ?? ""}`} className="calendar-notelink">
                        <button className="calendar-notelink-open" title={`Open "${nd.title}"`} onClick={() => onOpenNote(nd.note_id)}>
                          {nd.title || "Untitled"}
                        </button>
                        <button className="calendar-notelink-x" title="Unlink" aria-label="Unlink note" onClick={() => onUnlinkNote(nd)}>
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    <button
                      className="calendar-week-linknote"
                      title={t("calendar.linkNote")}
                      aria-label={t("calendar.linkNote")}
                      onClick={() => onLinkNote(day)}
                    >
                      <Link2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </ContextMenuTrigger>
                <CalendarDayMenu day={day} actions={actions} />
              </ContextMenu>
            );
          })}

          {lanes > 0 && (
            <div
              className="calendar-week-alldaylane"
              style={{ gridTemplateRows: `repeat(${lanes}, ${ALLDAY_LANE_REM}rem)` }}
            >
              {bars
                .filter((b) => b.lane < lanes)
                .map((b) => (
                  <EventContextMenu
                    key={eventKey(b.event)}
                    day={days[b.colStart]}
                    event={b.event}
                    actions={actions}
                  >
                    <button
                      className={`calendar-allday-bar${b.continuesLeft ? " continues-left" : ""}${
                        b.continuesRight ? " continues-right" : ""
                      }`}
                      style={{
                        gridColumn: `${b.colStart + 1} / span ${b.span}`,
                        gridRow: b.lane + 1,
                        ...barStyle(b.event.color),
                      }}
                      title={b.event.title}
                      onClick={() => onEventClick(days[b.colStart], b.event)}
                    >
                      {b.event.title || "(untitled)"}
                    </button>
                  </EventContextMenu>
                ))}
            </div>
          )}
        </div>
      </div>

      <div className="calendar-week-body">
        <div className="calendar-week-gutter">
          {HOURS.map((h) => (
            <div key={h} className="calendar-hour-label" style={{ height: `${HOUR_HEIGHT_REM}rem` }}>
              {hourLabel(h)}
            </div>
          ))}
        </div>
        {days.map((day) => {
          const key = dayKey(day);
          const cell = byDay.get(key);
          const segments = packDay(cell?.events ?? [], day);
          return (
            // One menu per column rather than per hour slot — 168 triggers a
            // week would be a lot of machinery for the same result; the clicked
            // hour comes from the pointer position instead.
            <ContextMenu key={key}>
              <ContextMenuTrigger asChild>
                <div
                  className="calendar-week-daycol"
                  style={{ height: `${HOURS.length * HOUR_HEIGHT_REM}rem` }}
                  onContextMenuCapture={hourAt}
                  onMouseDown={startDrag(day)}
                >
                  {HOURS.map((h) => (
                    <button
                      key={h}
                      className="calendar-hour-slot"
                      style={{ height: `${HOUR_HEIGHT_REM}rem` }}
                      title={`New event at ${hourLabel(h)}`}
                      aria-label={`New event at ${hourLabel(h)}`}
                      // Keyboard activation only (`detail === 0`). A MOUSE click
                      // is the tail of the press the column already handled, so
                      // letting it through here would open a second dialog —
                      // and one that ignored where in the hour it landed.
                      onClick={(e) => {
                        if (e.detail === 0) onSlotRange(day, h * 60, (h + 1) * 60);
                      }}
                    />
                  ))}
                  {drag?.key === key && drag.moved && <DraftBlock drag={drag} />}
                  {segments.map((segment) => (
                    <WeekEventBlock
                      key={eventKey(segment.event)}
                      segment={segment}
                      day={day}
                      onEventClick={onEventClick}
                      actions={actions}
                    />
                  ))}
                </div>
              </ContextMenuTrigger>
              <CalendarDayMenu day={day} hour={ctxHour} actions={actions} />
            </ContextMenu>
          );
        })}
      </div>
    </div>
  );
}

/** One timed event in the week grid: title, then its time — beside the title on
 * a short block and under it on a tall one, because two lines don't fit under
 * `SHORT_EVENT_MINUTES`. The block is flush to its column (`packDay` hands it a
 * share of the width, so overlapping events sit side by side rather than on top
 * of each other) and carries the accent stripe down its left edge from CSS. */
function WeekEventBlock({
  segment,
  day,
  onEventClick,
  actions,
}: {
  segment: DaySegment;
  day: Date;
  onEventClick: (day: Date, event: CalEvent) => void;
  actions: CalendarMenuActions;
}) {
  const dateLocale = useDateLocale();
  const timeFormat = useTheme((s) => s.timeFormat);
  const { event, startHour, endHour, col, cols } = segment;

  const compact = (endHour - startHour) * 60 < SHORT_EVENT_MINUTES;
  const at = (iso: string) => format(parseISO(iso), clockPattern(timeFormat), { locale: dateLocale });
  const start = at(event.start);
  const span = event.end ? `${start} – ${at(event.end)}` : start;
  const label = event.title || "(untitled)";

  return (
    <EventContextMenu day={day} event={event} actions={actions}>
      <button
        className={`calendar-week-event${compact ? " compact" : ""}`}
        style={{
          top: `${startHour * HOUR_HEIGHT_REM}rem`,
          height: `${(endHour - startHour) * HOUR_HEIGHT_REM}rem`,
          // Blocks share `WEEK_EVENT_WIDTH_PCT` of the column, not all of it —
          // the rest stays bare on the right. The 1px the width falls short of
          // its share is the gap between two side-by-side blocks.
          left: `${(col / cols) * WEEK_EVENT_WIDTH_PCT}%`,
          width: `calc(${(1 / cols) * WEEK_EVENT_WIDTH_PCT}% - 1px)`,
          ...(event.color ? { background: event.color, color: contrastText(event.color) } : {}),
        }}
        // A narrow column clips both lines, so the tooltip carries the whole
        // thing — including the end time a compact block has no room for.
        title={`${label} · ${span}`}
        onClick={() => onEventClick(day, event)}
      >
        <span className="calendar-week-event-title">{label}</span>
        <span className="calendar-week-event-time">{compact ? start : span}</span>
      </button>
    </EventContextMenu>
  );
}

/** The block a drag paints while it is being swept out — the same geometry as
 * the real `.calendar-week-event`s beside it, labelled with the snapped span it
 * would create. Non-interactive (CSS `pointer-events: none`), so the pointer
 * keeps measuring the column underneath rather than this. */
function DraftBlock({ drag }: { drag: SlotDrag }) {
  const dateLocale = useDateLocale();
  const timeFormat = useTheme((s) => s.timeFormat);
  const { from, to } = dragRange(drag);
  const label = (minutes: number) =>
    format(new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60), clockPattern(timeFormat), {
      locale: dateLocale,
    });

  return (
    <div
      className="calendar-week-draft"
      style={{
        top: `${(from / 60) * HOUR_HEIGHT_REM}rem`,
        height: `${((to - from) / 60) * HOUR_HEIGHT_REM}rem`,
        // Inline rather than in CSS so it can't drift from the real block's
        // width, which comes from the same constant.
        width: `calc(${WEEK_EVENT_WIDTH_PCT}% - 1px)`,
      }}
    >
      {`${label(from)} – ${label(to)}`}
    </div>
  );
}

/** Minutes past midnight of a local instant — the form `TimeField` speaks. */
const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();
/** The last minute of a day, so a time nudged forward can't roll into the next. */
const LAST_MINUTE = 24 * 60 - 1;
/** What "Every N days" starts at when it's first chosen. Not 1 — that's already
 *  the Daily entry above it, so opening on 1 would look like a broken duplicate. */
const DEFAULT_CUSTOM_DAYS = 2;
/** Where a new event lands when nothing named a time — the toolbar's "+ Event"
 *  and a month cell's "New event". Mid-morning rather than midnight: the dialog
 *  leads with its two time fields, so it has to open on a time worth keeping. */
const DEFAULT_EVENT_HOUR = 9;

/** The Repeat dropdown's entries. Everything except `custom` is `interval: 1` of
 *  one unit; `custom` is the same shape with a user-supplied day count. */
type RepeatChoice = "none" | "daily" | "weekly" | "yearly" | "custom";

/** Which entry a stored repeat shows as. A non-day unit stays on its named entry
 *  whatever its interval, so a hand-written "every 3 weeks" in calendar.json is
 *  never silently rewritten to days by merely opening the dialog. */
function repeatChoiceOf(repeat: Repeat | null | undefined): RepeatChoice {
  if (!repeat) return "none";
  if (repeat.unit === "week") return "weekly";
  if (repeat.unit === "year") return "yearly";
  return repeat.interval === 1 ? "daily" : "custom";
}

/**
 * Create or edit an event: a title across the top, a month to pick the day (or a
 * span of days) on the left, and its times, colour and repeat on the right.
 *
 * The date lives ONLY in the month — clicking a day starts a range and clicking
 * a second one closes it — and the clock times only in the two `TimeField`s, so
 * "when" is never split across two controls that could disagree.
 *
 * `range` — set when opened from the week view's hourly grid (a clicked or
 * dragged span) or the day menu's "New event" over an hour, never alongside
 * `event` — pre-fills a timed block. Without it the new event is all-day.
 *
 * Editing any occurrence of a repeating event edits the whole series; the core
 * re-anchors the times it gets back (see `rebase_onto_series`).
 */
function EventDialog({
  day,
  event,
  range,
  allDay: allDayDefault,
  onClose,
  onSaved,
  onDelete,
  onError,
}: {
  day: Date;
  event?: CalEvent;
  range?: TimeRange;
  /** Open with "All day" already ticked — a span swept across the day headers,
   *  which names days and no hours. */
  allDay?: boolean;
  onClose: () => void;
  onSaved: () => void;
  onDelete: (event: CalEvent) => void;
  onError: (m: string) => void;
}) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const initialStart = event
    ? parseISO(event.start)
    : (range?.start ?? addMinutes(startOfDay(day), DEFAULT_EVENT_HOUR * 60));
  const initialEnd = event?.end ? parseISO(event.end) : (range?.end ?? null);

  const [title, setTitle] = useState(event?.title ?? "");
  // A new event is timed unless the user says otherwise. All-day is one tick
  // away, and the reverse default would open the dialog with its two headline
  // controls greyed out.
  const [allDay, setAllDay] = useState(event?.all_day ?? allDayDefault ?? false);
  const [startDay, setStartDay] = useState(startOfDay(initialStart));
  const [endDay, setEndDay] = useState(startOfDay(initialEnd ?? initialStart));
  const [startMin, setStartMin] = useState(minutesOf(initialStart));
  const [endMin, setEndMin] = useState(
    initialEnd ? minutesOf(initialEnd) : Math.min(LAST_MINUTE, minutesOf(initialStart) + DEFAULT_EVENT_MINUTES),
  );
  const [color, setColor] = useState<string | null>(event?.color ?? null);
  const [repeat, setRepeat] = useState<Repeat | null>(event?.repeat ?? null);
  const [monthCursor, setMonthCursor] = useState(startOfDay(initialStart));
  // Whether the next click in the month CLOSES the range rather than starting a
  // new one. Starts false, so the first click on an opened dialog always means
  // "this day", however many days the event already covers.
  const [pickingEnd, setPickingEnd] = useState(false);
  const [busy, setBusy] = useState(false);

  const oneDay = isSameDay(startDay, endDay);

  const pickDay = (picked: Date) => {
    const at = startOfDay(picked);
    if (pickingEnd && at >= startDay) {
      setEndDay(at);
      setPickingEnd(false);
    } else {
      setStartDay(at);
      setEndDay(at);
      setPickingEnd(true);
      // Collapsing a multi-day span onto one day can leave the times crossed —
      // 14:00 → 09:00 was a perfectly good overnight span a moment ago.
      if (endMin < startMin) setEndMin(Math.min(LAST_MINUTE, startMin + DEFAULT_EVENT_MINUTES));
    }
  };

  // The two times can't cross on a single day, so each end pushes the other
  // rather than letting the pair go backwards: moving the start carries its
  // duration along, moving the end pulls the start down with it.
  const changeStart = (minutes: number) => {
    if (oneDay && minutes > endMin) {
      setEndMin(Math.min(LAST_MINUTE, minutes + Math.max(0, endMin - startMin)));
    }
    setStartMin(minutes);
  };
  const changeEnd = (minutes: number) => {
    if (oneDay && minutes < startMin) setStartMin(minutes);
    setEndMin(minutes);
  };

  const chooseRepeat = (choice: RepeatChoice) => {
    if (choice === "none") return setRepeat(null);
    // `until`/`skip` survive a change of pattern — they answer "how long does
    // this run for", which is a separate question from "how often".
    const kept = { until: repeat?.until ?? null, skip: repeat?.skip ?? [] };
    if (choice === "weekly") return setRepeat({ unit: "week", interval: 1, ...kept });
    if (choice === "yearly") return setRepeat({ unit: "year", interval: 1, ...kept });
    if (choice === "daily") return setRepeat({ unit: "day", interval: 1, ...kept });
    const current = repeat?.unit === "day" ? repeat.interval : 1;
    setRepeat({
      unit: "day",
      interval: current > 1 ? current : DEFAULT_CUSTOM_DAYS,
      ...kept,
    });
  };

  const choice = repeatChoiceOf(repeat);

  const save = async () => {
    setBusy(true);
    try {
      // All-day events pin to local midnight; the store keeps UTC and the
      // day-span math (byDay, calendar.range) handles display from that.
      const startInstant = allDay ? startDay : addMinutes(startDay, startMin);
      const endInstant = allDay ? endDay : addMinutes(endDay, endMin);
      const payload: CalEvent = {
        id: event?.id ?? "",
        title: title.trim(),
        start: startInstant.toISOString(),
        end: endInstant.toISOString(),
        all_day: allDay,
        note_ids: event?.note_ids ?? [],
        color,
        repeat,
        // Carried back untouched: it tells the core WHICH occurrence these
        // instants came from, which is what lets it re-anchor the series.
        occurrence: event?.occurrence ?? null,
      };
      if (event) await calendar.updateEvent(payload);
      else await calendar.createEvent(payload);
      onSaved();
    } catch (e) {
      onError(localizeError(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="calendar-event-dialog">
        {/* The title input IS the dialog's heading, so the accessible one is
            hidden rather than drawn twice. */}
        <DialogHeader className="sr-only">
          <DialogTitle>{event ? t("calendar.editEventTitle") : t("calendar.newEvent")}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          className="calendar-title-input"
          placeholder={t("calendar.addName")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="calendar-event-body">
          <MiniMonth
            cursor={monthCursor}
            onCursorChange={setMonthCursor}
            onSelectDay={pickDay}
            range={{ start: startDay, end: endDay }}
            showMarks={false}
            fitHeight={false}
          />
          <div className="calendar-event-fields">
            <div className="calendar-time-row">
              <TimeField
                value={startMin}
                onChange={changeStart}
                disabled={allDay}
                aria-label={t("calendar.startTime")}
              />
              <span className="calendar-time-dash">–</span>
              <TimeField
                value={endMin}
                onChange={changeEnd}
                disabled={allDay}
                aria-label={t("calendar.endTime")}
              />
            </div>

            <label className="calendar-check">
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
              {t("calendar.allDay")}
            </label>

            <div className="calendar-field">
              <span className="calendar-field-label">{t("calendar.colour")}</span>
              <div className="calendar-swatches">
                <button
                  type="button"
                  className={`calendar-swatch none${color === null ? " active" : ""}`}
                  title={t("calendar.colourNone")}
                  aria-label={t("calendar.colourNone")}
                  onClick={() => setColor(null)}
                />
                {COLORS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    className={`calendar-swatch${color === c ? " active" : ""}`}
                    style={{ background: c }}
                    aria-label={c}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>

            <div className="calendar-field">
              <Select value={choice} onValueChange={(v) => chooseRepeat(v as RepeatChoice)}>
                <SelectTrigger className="calendar-repeat-select" aria-label={t("calendar.repeat")}>
                  <SelectValue placeholder={t("calendar.repeat")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("calendar.repeatNever")}</SelectItem>
                  <SelectItem value="daily">{t("calendar.repeatDaily")}</SelectItem>
                  <SelectItem value="weekly">{t("calendar.repeatWeekly")}</SelectItem>
                  <SelectItem value="yearly">{t("calendar.repeatYearly")}</SelectItem>
                  <SelectItem value="custom">{t("calendar.repeatCustom")}</SelectItem>
                </SelectContent>
              </Select>

              {choice === "custom" && repeat && (
                <div className="calendar-repeat-span">
                  <span>{t("calendar.every")}</span>
                  <Input
                    type="number"
                    min={1}
                    className="calendar-repeat-interval"
                    aria-label={t("calendar.repeatCustom")}
                    value={repeat.interval}
                    onChange={(e) =>
                      setRepeat({ ...repeat, interval: Math.max(1, Number(e.target.value) || 1) })
                    }
                  />
                  <span>{t("calendar.days")}</span>
                </div>
              )}

              {repeat && (
                <div className="calendar-repeat-until">
                  {repeat.until ? (
                    <>
                      <span className="calendar-field-label">{t("calendar.until")}</span>
                      <DateTimePicker
                        value={parseISO(repeat.until)}
                        onChange={(d) => setRepeat({ ...repeat, until: dayKey(d) })}
                        showTime={false}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("calendar.untilClear")}
                        onClick={() => setRepeat({ ...repeat, until: null })}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setRepeat({ ...repeat, until: dayKey(addMonths(startDay, 1)) })}
                    >
                      {t("calendar.untilAdd")}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Which days the event actually covers is otherwise only readable
                off the month's highlight — spelled out here so a two-day span
                can't be mistaken for a mis-click. */}
            <p className="calendar-event-summary">
              {oneDay
                ? formatCap(startDay, "EEEE, MMM d", dateLocale)
                : `${formatCap(startDay, "MMM d", dateLocale)} – ${formatCap(endDay, "MMM d", dateLocale)}`}
            </p>
          </div>
        </div>
        <DialogFooter className="calendar-dialog-footer">
          {event && (
            <Button
              variant="outline"
              className="calendar-delete"
              disabled={busy}
              onClick={() => onDelete(event)}
            >
              <Trash2 className="h-4 w-4" /> {t("common.delete")}
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={busy}>
            {event ? t("common.save") : t("calendar.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Delete this day, or all of them?" — the one question a repeating event has
 *  to ask, since both answers are things people mean. Only ever shown for an
 *  expanded occurrence; everything else deletes without a prompt. */
function DeleteSeriesDialog({
  event,
  onClose,
  onDeleteDay,
  onDeleteSeries,
}: {
  event: CalEvent;
  onClose: () => void;
  onDeleteDay: () => void;
  onDeleteSeries: () => void;
}) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const on = event.occurrence ? formatCap(parseISO(event.occurrence), "MMM d, yyyy", dateLocale) : "";

  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{event.title || t("common.untitled")}</AlertDialogTitle>
          <AlertDialogDescription>{t("calendar.deleteRepeatingPrompt")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="outline" onClick={onDeleteDay}>
            {t("calendar.deleteThisDay", { date: on })}
          </AlertDialogAction>
          <AlertDialogAction variant="destructive" onClick={onDeleteSeries}>
            {t("calendar.deleteSeries")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Pick a note to link to `day` (a bare note→date link, `event_id` = null). */
function LinkNoteDialog({
  day,
  onClose,
  onLinked,
  onError,
}: {
  day: Date;
  onClose: () => void;
  onLinked: () => void;
  onError: (m: string) => void;
}) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [all, setAll] = useState<NoteSummary[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    notes.list().then(setAll).catch((e) => onError(localizeError(e, t)));
  }, [onError, t]);

  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q ? all.filter((n) => n.title.toLowerCase().includes(q)) : all;
    return list.slice(0, 50);
  }, [all, filter]);

  const link = (id: string) => {
    calendar
      .addNoteDate(id, { date: dayKey(day), event_id: null })
      .then(onLinked)
      .catch((e) => onError(localizeError(e, t)));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link a note to {formatCap(day, "MMM d, yyyy", dateLocale)}</DialogTitle>
        </DialogHeader>
        <Input autoFocus placeholder="Search notes…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <ul className="calendar-notepicker">
          {matches.map((n) => (
            <li key={n.id}>
              <button onClick={() => link(n.id)}>{n.title || "Untitled"}</button>
            </li>
          ))}
          {matches.length === 0 && <li className="muted calendar-notepicker-empty">No notes match.</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
