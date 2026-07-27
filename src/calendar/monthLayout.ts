/**
 * Calendar layout maths, for both grids. Two axes, same discipline:
 *
 * - `packWeek` — spanning events (all-day, or crossing a day boundary) become
 *   continuous bars across a week row, clipped at each week boundary and stacked
 *   into lanes so overlapping bars never collide.
 * - `packDay` — the week view's timed events become blocks down ONE day column,
 *   split into side-by-side columns wherever they overlap.
 *
 * Pure functions, no React: the grids just map the result onto CSS grid
 * columns/rows (month) or absolute offsets (week).
 */
import {
  addDays,
  addMinutes,
  differenceInCalendarDays,
  differenceInMinutes,
  eachDayOfInterval,
  parseISO,
  startOfDay,
} from "date-fns";

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

/**
 * A rendered event's identity. A repeating event is ONE stored record expanded
 * into many occurrences by the core, so several events in a grid legitimately
 * share an `id` — the day pins down which one. Use this, never the bare id, for
 * React keys and per-event lookups.
 */
export const eventKey = (ev: CalEvent): string =>
  ev.occurrence ? `${ev.id}@${ev.occurrence}` : ev.id;

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

/** One timed event's box within ONE day column of the week grid. */
export interface DaySegment {
  event: CalEvent;
  /** Fractional hours from midnight — the block's top edge. */
  startHour: number;
  /** Fractional hours from midnight — the block's bottom edge. */
  endHour: number;
  /** 0-based column within its overlap cluster, 0 = leftmost. */
  col: number;
  /** How many columns the cluster splits into (>= 1). */
  cols: number;
}

/**
 * Lay out the timed events that begin AND end on `day` as blocks down its
 * column, as fractional hour offsets from midnight. Anything `isSpanning`
 * (all-day, or crossing a day boundary) is excluded: it draws as one continuous
 * bar in the all-day strip instead of a block per day — the same split
 * `dayItems` makes for month cells. The clipping below is therefore a no-op for
 * the events that survive the filter, kept as the guard that a block can never
 * escape its own column.
 *
 * Overlapping blocks split the column between them rather than stacking on top
 * of each other: events are grouped into *clusters* (maximal runs of mutually
 * reachable overlap), and each cluster is divided into as many columns as its
 * busiest moment needs.
 */
export function packDay(events: CalEvent[], day: Date): DaySegment[] {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);

  const spans: Omit<DaySegment, "col" | "cols">[] = [];
  for (const ev of events) {
    if (isSpanning(ev)) continue;
    const evStart = parseISO(ev.start);
    // Untimed-end events get a nominal 30min block so they're visible/clickable.
    const evEnd = ev.end ? parseISO(ev.end) : addMinutes(evStart, 30);
    if (evEnd <= dayStart || evStart >= dayEnd) continue;
    const clippedStart = evStart < dayStart ? dayStart : evStart;
    const clippedEnd = evEnd > dayEnd ? dayEnd : evEnd;
    const startHour = differenceInMinutes(clippedStart, dayStart) / 60;
    // A floor of half an hour: a zero-length event would otherwise be an
    // invisible, unclickable block.
    const endHour = Math.max(differenceInMinutes(clippedEnd, dayStart) / 60, startHour + 0.5);
    spans.push({ event: ev, startHour, endHour });
  }

  // Earliest first, then longest, then a name/id tiebreak — the same four keys
  // `packWeek` sorts on, and for the same reason: without a total order the
  // column assignment would shuffle between renders on equal starts.
  spans.sort(
    (a, b) =>
      a.startHour - b.startHour ||
      b.endHour - a.endHour ||
      a.event.title.localeCompare(b.event.title) ||
      a.event.id.localeCompare(b.event.id),
  );

  const out: DaySegment[] = [];
  // The cluster being built, and where each of its columns is currently free.
  // A cluster ends at the first block starting at or after EVERY open column's
  // end — i.e. the first moment the day column is empty again.
  let cluster: DaySegment[] = [];
  let colEnds: number[] = [];

  /** Stamp the finished cluster's width onto every member and emit it. */
  const flush = () => {
    for (const seg of cluster) seg.cols = colEnds.length;
    out.push(...cluster);
    cluster = [];
    colEnds = [];
  };

  for (const span of spans) {
    if (colEnds.length > 0 && span.startHour >= Math.max(...colEnds)) flush();
    // Leftmost column whose last occupant has already ended. Touching blocks
    // (one ends exactly as the next starts) share a column — they don't overlap.
    let col = colEnds.findIndex((end) => end <= span.startHour);
    if (col === -1) col = colEnds.length;
    colEnds[col] = span.endHour;
    cluster.push({ ...span, col, cols: 1 });
  }
  if (cluster.length > 0) flush();

  return out;
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
