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
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Link2, Plus, Trash2, X } from "lucide-react";

import { calendar, notes } from "@/services";
import type { Event as CalEvent, NoteDate, NoteDateEntry, NoteSummary } from "@/services";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Mode = "month" | "week";

/** Optional event colours, keyed to a small preset palette so chips stay legible. */
const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7"];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A day's vault-relative key (`yyyy-MM-dd`), matching the `NoteDate` date form. */
const dayKey = (d: Date) => format(d, "yyyy-MM-dd");

/** A dialog request: create/edit an event, or link a note — to a specific day. */
type DialogState =
  | { kind: "event"; day: Date; event?: CalEvent }
  | { kind: "linkNote"; day: Date }
  | null;

export function CalendarView({
  onOpenNote,
  onError,
}: {
  onOpenNote: (id: string) => void;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("month");
  // A date inside the currently-shown period; navigation moves it by month/week.
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [noteDates, setNoteDates] = useState<NoteDateEntry[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);

  // The visible grid: whole weeks covering the month, or a single week.
  const days = useMemo(() => {
    if (mode === "week") {
      return eachDayOfInterval({ start: startOfWeek(cursor), end: endOfWeek(cursor) });
    }
    return eachDayOfInterval({
      start: startOfWeek(startOfMonth(cursor)),
      end: endOfWeek(endOfMonth(cursor)),
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

  return (
    <div className="calendar">
      <div className="calendar-header">
        <h1 className="calendar-title">{heading}</h1>
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
      </div>

      <div className="calendar-weekdays">
        {WEEKDAYS.map((w) => (
          <div key={w} className="calendar-weekday">
            {w}
          </div>
        ))}
      </div>

      <div className={`calendar-grid ${mode}`}>
        {days.map((day) => {
          const key = dayKey(day);
          const cell = byDay.get(key);
          const dim = mode === "month" && !isSameMonth(day, cursor);
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

      {dialog?.kind === "event" && (
        <EventDialog
          day={dialog.day}
          event={dialog.event}
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
  );
}

/** Create or edit a single event. Shows a Delete action when editing. */
function EventDialog({
  day,
  event,
  onClose,
  onSaved,
  onError,
}: {
  day: Date;
  event?: CalEvent;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const initialStart = event ? parseISO(event.start) : day;
  const initialEnd = event?.end ? parseISO(event.end) : null;
  const [title, setTitle] = useState(event?.title ?? "");
  const [allDay, setAllDay] = useState(event?.all_day ?? true);
  const [startDate, setStartDate] = useState(format(initialStart, "yyyy-MM-dd"));
  const [startTime, setStartTime] = useState(format(initialStart, "HH:mm"));
  const [endDate, setEndDate] = useState(initialEnd ? format(initialEnd, "yyyy-MM-dd") : "");
  const [endTime, setEndTime] = useState(initialEnd ? format(initialEnd, "HH:mm") : "09:00");
  const [color, setColor] = useState<string | null>(event?.color ?? null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      // Build UTC ISO instants from the local date/time inputs. All-day events
      // pin to local midnight; the store keeps UTC and the day-span math handles
      // display.
      const start = new Date(`${startDate}T${allDay ? "00:00" : startTime}`).toISOString();
      const end = endDate
        ? new Date(`${endDate}T${allDay ? "00:00" : endTime}`).toISOString()
        : null;
      const payload: CalEvent = {
        id: event?.id ?? "",
        title: title.trim(),
        start,
        end,
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
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            {!allDay && <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />}
          </div>
          <div className="calendar-form-row">
            <span>End</span>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} placeholder="(optional)" />
            {!allDay && endDate && (
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
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
          <Button onClick={save} disabled={busy || !startDate}>
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
