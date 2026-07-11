/**
 * Calendar view (Phase 3 step 2) — month/week grid over the vault's events and
 * note→date links. React renders and dispatches; ALL data + persistence go
 * through the `calendar`/`notes` services (never `@tauri-apps/api` here). Events
 * (incl. multi-day time periods) and notes linked to a date are shown per day;
 * events can be created/edited/deleted, notes linked/unlinked to a day, and a
 * linked note opened (which switches to the editor via `onOpenNote`).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
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

import { calendar, notes } from "@/services";
import type { Event as CalEvent, NoteDate, NoteDateEntry, NoteSummary } from "@/services";
import { useTheme } from "@/store/theme";
import { useViewState } from "@/store/viewState";
import { ViewFrame } from "@/components/ViewFrame";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DateTimePicker } from "@/components/DateTimePicker";
import { Button } from "@/components/ui/button";

type Mode = "month" | "week";

/** Optional event colours, keyed to a small preset palette so chips stay legible. */
const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7"];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Weeks start Monday throughout the calendar (date-fns: 0 = Sunday, 1 = Monday). */
const WEEK_STARTS_ON = 1;

/** Hour rows the week view's time grid renders, midnight to 11pm. */
const HOURS = Array.from({ length: 24 }, (_, i) => i);
/** Must match `--calendar-hour-height` in index.css — kept as one number so the
 * hour-click and event-position math never drifts from the actual row height. */
const HOUR_HEIGHT_REM = 3.5;

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
  const [mode, setMode] = useState<Mode>("month");
  // A date inside the currently-shown period; navigation moves it by month/week.
  // Jumps to the Home widget's clicked day when set (consumed once — see
  // useViewState's calendarTarget doc comment).
  const [cursor, setCursor] = useState<Date>(() => useViewState.getState().calendarTarget ?? new Date());
  useEffect(() => {
    if (useViewState.getState().calendarTarget) useViewState.getState().setCalendarTarget(null);
  }, []);
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
      .catch((e) => onError(String(e)));
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
    setCursor((c) => (mode === "week" ? addWeeks(c, delta) : addMonths(c, delta)));

  const heading =
    mode === "week"
      ? `${format(gridStart, "MMM d")} – ${format(gridEnd, "MMM d, yyyy")}`
      : format(cursor, "MMMM yyyy");

  const unlinkNote = useCallback(
    (nd: NoteDateEntry) => {
      const date: NoteDate = { date: nd.date, event_id: nd.event_id };
      calendar.removeNoteDate(nd.note_id, date).then(load).catch((e) => onError(String(e)));
    },
    [load, onError],
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
        <>
          <div className="calendar-weekdays">
            {WEEKDAYS.map((w) => (
              <div key={w} className="calendar-weekday">
                {w}
              </div>
            ))}
          </div>

          <div className="calendar-grid month">
            {days.map((day) => {
              const key = dayKey(day);
              const cell = byDay.get(key);
              const dim = !isSameMonth(day, cursor);
              return (
                <div key={key} className={`calendar-cell${dim ? " dim" : ""}${isToday(day) ? " today" : ""}`}>
                  <div className="calendar-cell-head">
                    <span className="calendar-daynum">{format(day, "d")}</span>
                    <span className="calendar-cell-actions">
                      <button title="Link a note to this day" aria-label="Link a note to this day"
                        onClick={() => setDialog({ kind: "linkNote", day })}>
                        <Link2 className="h-3.5 w-3.5" />
                      </button>
                      <button title="New event" aria-label="New event"
                        onClick={() => setDialog({ kind: "event", day })}>
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                  <div className="calendar-cell-body">
                    {cell?.events.map((ev) => (
                      <button
                        key={ev.id}
                        className="calendar-event"
                        style={ev.color ? { background: ev.color, borderColor: ev.color, color: "#fff" } : undefined}
                        title={ev.title}
                        onClick={() => setDialog({ kind: "event", day, event: ev })}
                      >
                        {ev.title || "(untitled)"}
                      </button>
                    ))}
                    {cell?.notes.map((nd) => (
                      <span key={`${nd.note_id}:${nd.event_id ?? ""}`} className="calendar-notelink">
                        <button className="calendar-notelink-open" title={`Open "${nd.title}"`} onClick={() => onOpenNote(nd.note_id)}>
                          {nd.title || "Untitled"}
                        </button>
                        <button className="calendar-notelink-x" title="Unlink" aria-label="Unlink note" onClick={() => unlinkNote(nd)}>
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
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
  const timeFormat = useTheme((s) => s.timeFormat);
  const hourLabel = (h: number) => format(new Date(2000, 0, 1, h), timeFormat === "24h" ? "HH:mm" : "h a");

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
                <span>{format(day, "EEE")}</span>
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
      onError(String(e));
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
      onError(String(e));
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
  const [all, setAll] = useState<NoteSummary[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    notes.list().then(setAll).catch((e) => onError(String(e)));
  }, [onError]);

  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q ? all.filter((n) => n.title.toLowerCase().includes(q)) : all;
    return list.slice(0, 50);
  }, [all, filter]);

  const link = (id: string) => {
    calendar
      .addNoteDate(id, { date: dayKey(day), event_id: null })
      .then(onLinked)
      .catch((e) => onError(String(e)));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link a note to {format(day, "MMM d, yyyy")}</DialogTitle>
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
