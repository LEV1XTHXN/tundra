/**
 * "Next up" — the handful of events between today and a month out, in the
 * calendar sidebar under the mini month.
 *
 * The mini month tells you *where* you are; this tells you what's coming, which
 * is the question a calendar is usually opened to answer and which neither grid
 * answers when you've paged away from today. Read-only: clicking a row moves
 * the cursor to that day, the same gesture as clicking a mini-month cell.
 */
import { useEffect, useState } from "react";
import { addDays, format, isSameDay, parseISO } from "date-fns";
import { useTranslation } from "react-i18next";

import { calendar, type Event } from "@/services";
import { useDateLocale } from "@/i18n/dateLocale";
import { useViewState } from "@/store/viewState";

/** How far ahead to look, and how many rows to show. A sidebar list, not an
 *  agenda view — the grid is right there for the rest. */
const HORIZON_DAYS = 31;
const MAX_ROWS = 4;

const iso = (d: Date) => format(d, "yyyy-MM-dd");

export function CalendarNextUp({ refreshKey }: { refreshKey?: unknown }) {
  const { t } = useTranslation();
  const locale = useDateLocale();
  const setCursor = useViewState((s) => s.setCalendarCursor);
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    let cancelled = false;
    const today = new Date();
    calendar
      .range(iso(today), iso(addDays(today, HORIZON_DAYS)))
      .then((range) => {
        if (cancelled) return;
        // `range` expands repeats into per-occurrence clones already, so this
        // is a plain sort — no series logic here.
        const upcoming = [...range.events]
          .sort((a, b) => a.start.localeCompare(b.start))
          .slice(0, MAX_ROWS);
        setEvents(upcoming);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (events.length === 0) return null;

  const today = new Date();

  return (
    <div className="calendar-nextup">
      <h3 className="calendar-sidebar-heading">{t("calendar.nextUp")}</h3>
      {events.map((ev) => {
        const day = parseISO(ev.start);
        return (
          <button
            key={`${ev.id}:${ev.occurrence ?? ev.start}`}
            className="calendar-nextup-row"
            onClick={() => setCursor(day)}
          >
            <span
              className="calendar-nextup-dot"
              style={ev.color ? { background: ev.color } : undefined}
            />
            <span className="calendar-nextup-when">
              {isSameDay(day, today)
                ? t("calendar.today")
                : format(day, day.getFullYear() === today.getFullYear() ? "EEE d MMM" : "d MMM yyyy", {
                    locale,
                  })}
            </span>
            <span className="calendar-nextup-title">{ev.title || t("calendar.untitledEvent")}</span>
          </button>
        );
      })}
    </div>
  );
}
