/**
 * A compact month calendar: a month-nav header and a 7-column day grid, with a
 * dot on every day carrying an event or a note→date link. Shared by two
 * surfaces — the Home dashboard's Calendar widget and the shell sidebar while
 * the Calendar view is open — so the little month exists once, not twice.
 *
 * Presentation + its own `calendar.range` fetch for the dots; the cursor and
 * the selected day are owned by the caller.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  addDays,
  addMonths,
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
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { calendar } from "@/services";
import { formatCap, useDateLocale } from "@/i18n/dateLocale";

/** Weeks start Monday throughout the calendar (date-fns: 0 = Sunday, 1 = Monday). */
const WEEK_STARTS_ON = 1;

export interface MiniMonthProps {
  /** A day inside the shown month. */
  cursor: Date;
  /** Month nav (‹ ›) — the caller decides where the cursor lives. */
  onCursorChange: (date: Date) => void;
  /** Clicking a day. */
  onSelectDay: (date: Date) => void;
  /** Ringed day, when the caller tracks a selection (the sidebar's current day). */
  selected?: Date | null;
  /**
   * `true` (default): day cells are squares sized in JS to fit BOTH the
   * available width and height, so the whole month is always visible without
   * scrolling at any container size — what the Home widget needs, since the
   * user resizes it freely. `false`: cells size from width alone (CSS
   * `aspect-ratio`), so the month takes its natural height instead of
   * stretching — what the fixed-width sidebar needs.
   */
  fitHeight?: boolean;
}

export function MiniMonth({
  cursor,
  onCursorChange,
  onSelectDay,
  selected,
  fitHeight = true,
}: MiniMonthProps) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [marked, setMarked] = useState<Set<string>>(new Set());

  const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: WEEK_STARTS_ON });
  const gridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: WEEK_STARTS_ON });
  const gridStartKey = format(gridStart, "yyyy-MM-dd");
  const gridEndKey = format(gridEnd, "yyyy-MM-dd");
  const gridDays = useMemo(
    () => eachDayOfInterval({ start: gridStart, end: gridEnd }),
    [gridStartKey, gridEndKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const weeks = gridDays.length / 7;
  // Locale-correct short weekday labels (e.g. "Mo"/"Пн"/"Mo") for the header
  // row, derived from the same week-start days rather than a hardcoded
  // English array.
  const weekdayLabels = useMemo(
    () => Array.from({ length: 7 }, (_, i) => formatCap(addDays(gridStart, i), "EEEEEE", dateLocale)),
    [gridStartKey, dateLocale], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Square-cell sizing for the `fitHeight` mode — see the prop's doc comment.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [cell, setCell] = useState(0);
  const weeksRef = useRef(weeks);
  weeksRef.current = weeks;
  useLayoutEffect(() => {
    if (!fitHeight) return;
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const size = Math.min(el.clientWidth / 7, el.clientHeight / weeksRef.current);
      setCell(Math.max(0, Math.floor(size)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [fitHeight]);
  useLayoutEffect(() => {
    if (!fitHeight) return;
    const el = gridRef.current;
    if (el) setCell(Math.max(0, Math.floor(Math.min(el.clientWidth / 7, el.clientHeight / weeks))));
  }, [fitHeight, weeks]);

  useEffect(() => {
    let cancelled = false;
    calendar
      .range(gridStartKey, gridEndKey)
      .then((r) => {
        if (cancelled) return;
        const next = new Set<string>();
        for (const ev of r.events) {
          const start = startOfDay(parseISO(ev.start));
          const end = ev.end ? startOfDay(parseISO(ev.end)) : start;
          for (const d of eachDayOfInterval({ start, end })) next.add(format(d, "yyyy-MM-dd"));
        }
        for (const nd of r.note_dates) next.add(nd.date);
        setMarked(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gridStartKey, gridEndKey]);

  // In fit-height mode the columns are fixed px squares; otherwise they share
  // the width evenly and the cells' aspect-ratio (CSS) keeps them square.
  const columns = fitHeight ? `repeat(7, ${cell}px)` : "repeat(7, 1fr)";

  return (
    <div className={`mini-calendar${fitHeight ? "" : " natural"}`}>
      <div className="mini-calendar-header">
        <button onClick={() => onCursorChange(subMonths(cursor, 1))} aria-label={t("home.previousMonth")}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        {/* `LLLL` (standalone month), not `MMMM` (the genitive form that goes
            with a day number) — see CalendarView's heading. */}
        <span className="mini-calendar-month">{formatCap(cursor, "LLLL yyyy", dateLocale)}</span>
        <button onClick={() => onCursorChange(addMonths(cursor, 1))} aria-label={t("home.nextMonth")}>
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mini-calendar-weekdays" style={{ gridTemplateColumns: columns }}>
        {weekdayLabels.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>
      <div
        className="mini-calendar-grid"
        ref={gridRef}
        style={{ gridTemplateColumns: columns, ...(fitHeight ? { gridAutoRows: `${cell}px` } : {}) }}
      >
        {gridDays.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dim = !isSameMonth(day, cursor);
          const isSelected = selected ? isSameDay(day, selected) : false;
          return (
            <button
              key={key}
              className={`mini-calendar-day${dim ? " dim" : ""}${isToday(day) ? " today" : ""}${
                isSelected ? " selected" : ""
              }${marked.has(key) ? " has-events" : ""}`}
              onClick={() => onSelectDay(day)}
              title={format(day, "EEEE, MMM d, yyyy", { locale: dateLocale })}
            >
              <span className="mini-calendar-daynum">{format(day, "d")}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
