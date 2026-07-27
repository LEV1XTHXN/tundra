/**
 * Month-view layout maths: turning events into the continuous bars the grid
 * draws across a week row. All-day events (and any event covering more than one
 * calendar day) render as a single bar spanning the days they cover — clipped
 * at each week boundary and stacked into lanes so overlapping bars never
 * collide. Pure functions, no React: the grid just maps the result onto CSS
 * grid columns/rows.
 */
import { differenceInCalendarDays, eachDayOfInterval, parseISO, startOfDay } from "date-fns";

import type { Event as CalEvent } from "@/services";

/** One event's bar within ONE week row. */
export interface WeekBar {
  event: CalEvent;
  /** First column the bar covers, 0–6 within the week. */
  colStart: number;
  /** How many columns it covers (>= 1). */
  span: number;
  /** Which stacked lane it sits in, 0 = topmost. */
  lane: number;
  /** The event started before this week — its left edge is a cut, not a start. */
  continuesLeft: boolean;
  /** The event ends after this week — its right edge is a cut, not an end. */
  continuesRight: boolean;
}

/** The inclusive day span an event covers, normalised (a backwards `end` is
 *  swapped, a missing `end` means a single day) — the same rule the view's
 *  per-day bucketing uses. */
export function eventDaySpan(ev: CalEvent): { from: Date; to: Date } {
  const start = startOfDay(parseISO(ev.start));
  const rawEnd = ev.end ? startOfDay(parseISO(ev.end)) : start;
  return rawEnd < start ? { from: rawEnd, to: start } : { from: start, to: rawEnd };
}

/** Events drawn as a bar rather than a `● 09:30 Title` row: all-day events, and
 *  timed events that run across more than one calendar day (a "time period" —
 *  there is no single clock time to lead with). */
export function isSpanning(ev: CalEvent): boolean {
  if (ev.all_day) return true;
  const { from, to } = eventDaySpan(ev);
  return differenceInCalendarDays(to, from) > 0;
}

/**
 * Lay out every spanning event that touches `week` (7 consecutive days) as
 * lane-packed bars. Bars are ordered by start column, then by longest span, so
 * the layout is stable across renders; each takes the topmost lane free for
 * every column it covers.
 */
export function packWeek(week: Date[], events: CalEvent[]): WeekBar[] {
  if (week.length === 0) return [];
  const weekStart = startOfDay(week[0]);
  const weekEnd = startOfDay(week[week.length - 1]);

  const candidates: Omit<WeekBar, "lane">[] = [];
  for (const ev of events) {
    if (!isSpanning(ev)) continue;
    const { from, to } = eventDaySpan(ev);
    if (to < weekStart || from > weekEnd) continue;
    const colStart = Math.max(0, differenceInCalendarDays(from, weekStart));
    const colEnd = Math.min(week.length - 1, differenceInCalendarDays(to, weekStart));
    candidates.push({
      event: ev,
      colStart,
      span: colEnd - colStart + 1,
      continuesLeft: from < weekStart,
      continuesRight: to > weekEnd,
    });
  }

  candidates.sort(
    (a, b) =>
      a.colStart - b.colStart ||
      b.span - a.span ||
      a.event.title.localeCompare(b.event.title) ||
      a.event.id.localeCompare(b.event.id),
  );

  // lanes[i] = the columns already taken in lane i.
  const lanes: boolean[][] = [];
  return candidates.map((bar) => {
    let lane = 0;
    for (; ; lane++) {
      if (!lanes[lane]) lanes[lane] = new Array(week.length).fill(false);
      const row = lanes[lane];
      let free = true;
      for (let c = bar.colStart; c < bar.colStart + bar.span; c++) {
        if (row[c]) {
          free = false;
          break;
        }
      }
      if (free) {
        for (let c = bar.colStart; c < bar.colStart + bar.span; c++) row[c] = true;
        break;
      }
    }
    return { ...bar, lane };
  });
}

/** Split a flat run of grid days into rows of 7 — the month grid's week rows. */
export function toWeeks(days: Date[]): Date[][] {
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

/** The days an event covers inside `week`, as a set of column indices — used to
 *  count a day's items for the "+N more" overflow. */
export function eachDayOfEvent(ev: CalEvent): Date[] {
  const { from, to } = eventDaySpan(ev);
  return eachDayOfInterval({ start: from, end: to });
}
