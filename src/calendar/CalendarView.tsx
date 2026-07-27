/**
 * Calendar view (Phase 3 step 2) — month/week grid over the vault's events and
 * note→date links. React renders and dispatches; ALL data + persistence go
 * through the `calendar`/`notes` services (never `@tauri-apps/api` here). Events
 * (incl. multi-day time periods) and notes linked to a date are shown per day;
 * events can be created/edited/deleted, notes linked/unlinked to a day, and a
 * linked note opened (which switches to the editor via `onOpenNote`).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  addDays,
  addHours,
  addMinutes,
  addMonths,
  addWeeks,
  differenceInMinutes,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  parseISO,
  set,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Link2, Plus, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { calendar, notes } from "@/services";
import type { Event as CalEvent, NoteDate, NoteDateEntry, NoteSummary } from "@/services";
import { useTheme } from "@/store/theme";
import { useViewState } from "@/store/viewState";
import { formatCap, useDateLocale } from "@/i18n/dateLocale";
import { localizeError } from "@/i18n/errors";
import { ViewFrame } from "@/components/ViewFrame";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { DateTimePicker } from "@/components/DateTimePicker";
import { Button } from "@/components/ui/button";
import { isSpanning, packWeek, toWeeks } from "./monthLayout";

type Mode = "month" | "week";

/** Optional event colours, keyed to a small preset palette so chips stay legible. */
const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7"];

/** Weeks start Monday throughout the calendar (date-fns: 0 = Sunday, 1 = Monday). */
const WEEK_STARTS_ON = 1;

/** Hour rows the week view's time grid renders, midnight to 11pm. */
const HOURS = Array.from({ length: 24 }, (_, i) => i);
/** Must match `--calendar-hour-height` in index.css — kept as one number so the
 * hour-click and event-position math never drifts from the actual row height. */
const HOUR_HEIGHT_REM = 3.5;

/** Month-cell metrics, in rem. These MUST match the corresponding heights in
 * index.css (`.calendar-cell-head`, `.calendar-allday-bar`, `.calendar-event-row`,
 * `.calendar-more`): the grid computes how many rows fit in a cell from them, so
 * a drift here shows up as a wrong "+N more" count. Same contract as
 * `HOUR_HEIGHT_REM` above. */
const MONTH_HEAD_REM = 1.75;
const MONTH_LANE_REM = 1.4;
const MONTH_ROW_REM = 1.35;
const MONTH_MORE_REM = 1.2;
/** The weekday label ("MON") that heads each cell of the FIRST week row only —
 * extra head height that row alone pays for. */
const MONTH_WEEKDAY_REM = 1.1;

/** A day's vault-relative key (`yyyy-MM-dd`), matching the `NoteDate` date form. */
const dayKey = (d: Date) => format(d, "yyyy-MM-dd");

/** A dialog request: create/edit an event, or link a note — to a specific day. */
type DialogState =
  | { kind: "event"; day: Date; event?: CalEvent; hour?: number }
  | { kind: "linkNote"; day: Date }
  | null;

/** Timed (non-all-day) events on `day`, clipped to its 24h span, as fractional
 * hour offsets from midnight — the input the week view's hour grid positions
 * event blocks from. */
function timedSegmentsForDay(events: CalEvent[], day: Date) {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const segments: { event: CalEvent; startHour: number; endHour: number }[] = [];
  for (const ev of events) {
    if (ev.all_day) continue;
    const evStart = parseISO(ev.start);
    // Untimed-end events get a nominal 30min block so they're visible/clickable.
    const evEnd = ev.end ? parseISO(ev.end) : addMinutes(evStart, 30);
    if (evEnd <= dayStart || evStart >= dayEnd) continue;
    const clippedStart = evStart < dayStart ? dayStart : evStart;
    const clippedEnd = evEnd > dayEnd ? dayEnd : evEnd;
    const startHour = differenceInMinutes(clippedStart, dayStart) / 60;
    const endHour = Math.max(differenceInMinutes(clippedEnd, dayStart) / 60, startHour + 0.5);
    segments.push({ event: ev, startHour, endHour });
  }
  return segments;
}

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
          onNewEvent={(day) => setDialog({ kind: "event", day })}
          onLinkNote={(day) => setDialog({ kind: "linkNote", day })}
          onOpenNote={onOpenNote}
          onUnlinkNote={unlinkNote}
        />
      )}

      {mode === "week" && (
        <WeekTimeGrid
          days={days}
          byDay={byDay}
          onSlotClick={(day, hour) => setDialog({ kind: "event", day, hour })}
          onEventClick={(day, event) => setDialog({ kind: "event", day, event })}
          onOpenNote={onOpenNote}
          onUnlinkNote={unlinkNote}
          onLinkNote={(day) => setDialog({ kind: "linkNote", day })}
        />
      )}

      {dialog?.kind === "event" && (
        <EventDialog
          day={dialog.day}
          event={dialog.event}
          hour={dialog.hour}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            load();
          }}
          onError={onError}
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
  item.kind === "event" ? `e:${item.event.id}` : `n:${item.note.note_id}:${item.note.event_id ?? ""}`;

/**
 * Month mode's grid: a weekday header over one row per week. Within a week row,
 * all-day events (and multi-day periods) are drawn as CONTINUOUS bars in an
 * overlay grid — `packWeek` gives each its column span and lane — while timed
 * events and note links list underneath as rows inside their own day cell.
 *
 * Cells are fixed-height, so whatever doesn't fit collapses into a "+N more"
 * button that opens the full day in a popover. How much fits is computed from
 * the measured row height and the MONTH_*_REM metrics, rather than guessed.
 */
function MonthGrid({
  days,
  cursor,
  events,
  byDay,
  onEventClick,
  onNewEvent,
  onLinkNote,
  onOpenNote,
  onUnlinkNote,
}: {
  days: Date[];
  cursor: Date;
  events: CalEvent[];
  byDay: Map<string, { events: CalEvent[]; notes: NoteDateEntry[] }>;
  onEventClick: (day: Date, event: CalEvent) => void;
  onNewEvent: (day: Date) => void;
  onLinkNote: (day: Date) => void;
  onOpenNote: (id: string) => void;
  onUnlinkNote: (nd: NoteDateEntry) => void;
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
                  Math.floor((rowHeight / rem - headRem - MONTH_MORE_REM) / MONTH_LANE_REM),
                );
          const lanes = Math.min(laneCount, laneLimit);
          const rowCapacity =
            rowHeight === null
              ? Number.POSITIVE_INFINITY
              : Math.max(
                  0,
                  Math.floor((rowHeight / rem - headRem - lanes * MONTH_LANE_REM) / MONTH_ROW_REM),
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
                    <div
                      key={key}
                      className={`calendar-cell${isSameMonth(day, cursor) ? "" : " dim"}${
                        isToday(day) ? " today" : ""
                      }`}
                    >
                      <div className={`calendar-cell-head${weekIndex === 0 ? " with-weekday" : ""}`}>
                        {weekIndex === 0 && (
                          <span className="calendar-weekday-label">{weekdayLabels[col]}</span>
                        )}
                        <span className="calendar-daynum">
                          {format(day, day.getDate() === 1 ? "d MMM" : "d", { locale: dateLocale })}
                        </span>
                        <span className="calendar-cell-actions">
                          <button
                            title="Link a note to this day"
                            aria-label="Link a note to this day"
                            onClick={() => onLinkNote(day)}
                          >
                            <Link2 className="h-3.5 w-3.5" />
                          </button>
                          <button title="New event" aria-label="New event" onClick={() => onNewEvent(day)}>
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      </div>
                      <div
                        className="calendar-cell-body"
                        style={{ paddingTop: `${lanes * MONTH_LANE_REM}rem` }}
                      >
                        {items.slice(0, shown).map((item) => (
                          <DayItemRow
                            key={itemKey(item)}
                            item={item}
                            day={day}
                            onEventClick={onEventClick}
                            onOpenNote={onOpenNote}
                            onUnlinkNote={onUnlinkNote}
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
                                    <button
                                      key={b.event.id}
                                      className="calendar-allday-bar"
                                      style={barStyle(b.event.color)}
                                      onClick={() => {
                                        setPeekDay(null);
                                        onEventClick(day, b.event);
                                      }}
                                    >
                                      {b.event.title || "(untitled)"}
                                    </button>
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
                                  />
                                ))}
                              </div>
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {lanes > 0 && (
                <div
                  className="calendar-alldaylane"
                  style={{
                    top: `${headRem}rem`,
                    gridTemplateRows: `repeat(${lanes}, ${MONTH_LANE_REM}rem)`,
                  }}
                >
                  {bars
                    .filter((b) => b.lane < lanes)
                    .map((b) => (
                      <button
                        key={b.event.id}
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

/** An event's bar/dot colour: its own, or the theme accent when it has none. */
const barStyle = (color: string | null | undefined) =>
  color ? { background: color, color: "#fff" } : undefined;

/** One row in a day cell: `● 09:30 Zoom Sync` for a timed event, or the same
 * shape with a link glyph for a note tied to the day. */
function DayItemRow({
  item,
  day,
  onEventClick,
  onOpenNote,
  onUnlinkNote,
}: {
  item: DayItem;
  day: Date;
  onEventClick: (day: Date, event: CalEvent) => void;
  onOpenNote: (id: string) => void;
  onUnlinkNote: (nd: NoteDateEntry) => void;
}) {
  const dateLocale = useDateLocale();
  const timeFormat = useTheme((s) => s.timeFormat);

  if (item.kind === "event") {
    const ev = item.event;
    return (
      <button
        className="calendar-event-row"
        title={ev.title}
        onClick={() => onEventClick(day, ev)}
      >
        <span className="calendar-event-dot" style={ev.color ? { background: ev.color } : undefined} />
        <span className="calendar-event-time">
          {format(parseISO(ev.start), timeFormat === "24h" ? "HH:mm" : "h:mm a", { locale: dateLocale })}
        </span>
        <span className="calendar-event-title">{ev.title || "(untitled)"}</span>
      </button>
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

/** Week mode's hour-by-hour view: a gutter of hour labels, one scrollable
 * column per day, timed events positioned/sized by their clock time, all-day
 * events + note links shown in a header row above the grid. Clicking an empty
 * hour cell opens the event dialog pre-filled to start at that hour. */
function WeekTimeGrid({
  days,
  byDay,
  onSlotClick,
  onEventClick,
  onOpenNote,
  onUnlinkNote,
  onLinkNote,
}: {
  days: Date[];
  byDay: Map<string, { events: CalEvent[]; notes: NoteDateEntry[] }>;
  onSlotClick: (day: Date, hour: number) => void;
  onEventClick: (day: Date, event: CalEvent) => void;
  onOpenNote: (id: string) => void;
  onUnlinkNote: (nd: NoteDateEntry) => void;
  onLinkNote: (day: Date) => void;
}) {
  const dateLocale = useDateLocale();
  const timeFormat = useTheme((s) => s.timeFormat);
  const hourLabel = (h: number) =>
    format(new Date(2000, 0, 1, h), timeFormat === "24h" ? "HH:mm" : "h a", { locale: dateLocale });

  return (
    <div className="calendar-week">
      <div className="calendar-week-header">
        <div className="calendar-week-gutter" />
        {days.map((day) => {
          const key = dayKey(day);
          const cell = byDay.get(key);
          const allDayEvents = cell?.events.filter((ev) => ev.all_day) ?? [];
          return (
            <div key={key} className={`calendar-week-daycol-head${isToday(day) ? " today" : ""}`}>
              <div className="calendar-week-daylabel">
                <span>{format(day, "EEE", { locale: dateLocale })}</span>
                <span className="calendar-daynum">{format(day, "d")}</span>
              </div>
              <div className="calendar-week-allday">
                {allDayEvents.map((ev) => (
                  <button
                    key={ev.id}
                    className="calendar-event"
                    style={ev.color ? { background: ev.color, borderColor: ev.color, color: "#fff" } : undefined}
                    title={ev.title}
                    onClick={() => onEventClick(day, ev)}
                  >
                    {ev.title || "(untitled)"}
                  </button>
                ))}
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
                  title="Link a note to this day"
                  aria-label="Link a note to this day"
                  onClick={() => onLinkNote(day)}
                >
                  <Link2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
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
          const segments = timedSegmentsForDay(cell?.events ?? [], day);
          return (
            <div
              key={key}
              className="calendar-week-daycol"
              style={{ height: `${HOURS.length * HOUR_HEIGHT_REM}rem` }}
            >
              {HOURS.map((h) => (
                <button
                  key={h}
                  className="calendar-hour-slot"
                  style={{ height: `${HOUR_HEIGHT_REM}rem` }}
                  title={`New event at ${hourLabel(h)}`}
                  aria-label={`New event at ${hourLabel(h)}`}
                  onClick={() => onSlotClick(day, h)}
                />
              ))}
              {segments.map(({ event, startHour, endHour }) => (
                <button
                  key={event.id}
                  className="calendar-week-event"
                  style={{
                    top: `${startHour * HOUR_HEIGHT_REM}rem`,
                    height: `${(endHour - startHour) * HOUR_HEIGHT_REM}rem`,
                    ...(event.color ? { background: event.color, borderColor: event.color, color: "#fff" } : {}),
                  }}
                  title={event.title}
                  onClick={() => onEventClick(day, event)}
                >
                  {event.title || "(untitled)"}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Create or edit a single event. Shows a Delete action when editing.
 * `hour` — set when opened by clicking a slot in the week view's hourly grid
 * (never alongside `event`) — pre-fills a one-hour timed block starting then. */
function EventDialog({
  day,
  event,
  hour,
  onClose,
  onSaved,
  onError,
}: {
  day: Date;
  event?: CalEvent;
  hour?: number;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const { t } = useTranslation();
  const initialStart = event
    ? parseISO(event.start)
    : hour !== undefined
      ? set(day, { hours: hour, minutes: 0, seconds: 0, milliseconds: 0 })
      : set(day, { hours: 0, minutes: 0, seconds: 0, milliseconds: 0 });
  const initialEnd = event?.end
    ? parseISO(event.end)
    : hour !== undefined
      ? addHours(initialStart, 1)
      : null;
  const [title, setTitle] = useState(event?.title ?? "");
  const [allDay, setAllDay] = useState(event?.all_day ?? hour === undefined);
  const [start, setStart] = useState<Date>(initialStart);
  const [end, setEnd] = useState<Date | null>(initialEnd);
  const [color, setColor] = useState<string | null>(event?.color ?? null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      // All-day events pin to local midnight; the store keeps UTC and the
      // day-span math (byDay, calendar.range) handles display from that.
      const startInstant = allDay ? startOfDay(start) : start;
      const endInstant = end ? (allDay ? startOfDay(end) : end) : null;
      const payload: CalEvent = {
        id: event?.id ?? "",
        title: title.trim(),
        start: startInstant.toISOString(),
        end: endInstant ? endInstant.toISOString() : null,
        all_day: allDay,
        note_ids: event?.note_ids ?? [],
        color,
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

  const remove = async () => {
    if (!event) return;
    setBusy(true);
    try {
      await calendar.deleteEvent(event.id);
      onSaved();
    } catch (e) {
      onError(localizeError(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{event ? "Edit event" : "New event"}</DialogTitle>
        </DialogHeader>
        <div className="calendar-form">
          <Input autoFocus placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <label className="calendar-check">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day
          </label>
          <div className="calendar-form-row">
            <span>Start</span>
            <DateTimePicker value={start} onChange={setStart} showTime={!allDay} />
          </div>
          <div className="calendar-form-row">
            <span>End</span>
            {end ? (
              <>
                <DateTimePicker value={end} onChange={setEnd} showTime={!allDay} />
                <Button type="button" variant="ghost" size="icon" onClick={() => setEnd(null)} aria-label="Remove end date">
                  <X className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <Button type="button" variant="outline" onClick={() => setEnd(addHours(start, 1))}>
                + Add end
              </Button>
            )}
          </div>
          <div className="calendar-form-row">
            <span>Colour</span>
            <div className="calendar-swatches">
              <button
                type="button"
                className={`calendar-swatch none${color === null ? " active" : ""}`}
                title="None"
                onClick={() => setColor(null)}
              />
              {COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`calendar-swatch${color === c ? " active" : ""}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter className="calendar-dialog-footer">
          {event && (
            <Button variant="outline" className="calendar-delete" disabled={busy} onClick={remove}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {event ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
