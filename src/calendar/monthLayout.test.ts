import { describe, expect, it } from "vitest";
import type { Event as CalEvent } from "@/services";
import { addDays, eachDayOfInterval } from "date-fns";
import { isSpanning, packDay, packWeek, toWeeks } from "./monthLayout";

/** An all-day event over `[start, end]` (local dates, `end` inclusive). */
function allDay(id: string, start: string, end?: string): CalEvent {
  return {
    id,
    title: id,
    start: new Date(`${start}T00:00:00`).toISOString(),
    end: end ? new Date(`${end}T00:00:00`).toISOString() : null,
    all_day: true,
    note_ids: [],
    color: null,
  };
}

/** A timed event; single-day unless `end` is on a later date. */
function timed(id: string, start: string, end?: string): CalEvent {
  return {
    id,
    title: id,
    start: new Date(start).toISOString(),
    end: end ? new Date(end).toISOString() : null,
    all_day: false,
    note_ids: [],
    color: null,
  };
}

/** The 7 days of the week starting Monday `mondayIso`. */
function week(mondayIso: string) {
  const start = new Date(`${mondayIso}T00:00:00`);
  return eachDayOfInterval({ start, end: addDays(start, 6) });
}

describe("isSpanning", () => {
  it("treats all-day events as bars, whatever their length", () => {
    expect(isSpanning(allDay("a", "2026-07-02"))).toBe(true);
    expect(isSpanning(allDay("b", "2026-07-02", "2026-07-05"))).toBe(true);
  });

  it("leaves single-day timed events as rows", () => {
    expect(isSpanning(timed("c", "2026-07-02T09:30:00", "2026-07-02T10:30:00"))).toBe(false);
    expect(isSpanning(timed("d", "2026-07-02T09:30:00"))).toBe(false);
  });

  it("promotes a timed event that crosses midnight into a bar", () => {
    expect(isSpanning(timed("e", "2026-07-02T22:00:00", "2026-07-03T02:00:00"))).toBe(true);
  });
});

describe("packWeek", () => {
  // Mon 2026-06-29 … Sun 2026-07-05.
  const w = week("2026-06-29");

  it("places a single-day all-day event in one column, lane 0", () => {
    const [bar] = packWeek(w, [allDay("Alina birthday", "2026-07-02")]);
    expect(bar).toMatchObject({
      colStart: 3,
      span: 1,
      lane: 0,
      continuesLeft: false,
      continuesRight: false,
    });
  });

  it("spans a multi-day event across its columns as ONE bar", () => {
    const bars = packWeek(w, [allDay("Expo", "2026-06-30", "2026-07-02")]);
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ colStart: 1, span: 3, continuesLeft: false, continuesRight: false });
  });

  it("clips at week boundaries and flags the cut edges", () => {
    const ev = allDay("Trip", "2026-06-27", "2026-07-08");
    const first = packWeek(w, [ev])[0];
    expect(first).toMatchObject({ colStart: 0, span: 7, continuesLeft: true, continuesRight: true });

    const next = packWeek(week("2026-07-06"), [ev])[0];
    expect(next).toMatchObject({ colStart: 0, span: 3, continuesLeft: true, continuesRight: false });
  });

  it("stacks overlapping bars into separate lanes", () => {
    const bars = packWeek(w, [
      allDay("A", "2026-06-29", "2026-07-01"),
      allDay("B", "2026-06-30", "2026-07-02"),
      allDay("C", "2026-07-03"),
    ]);
    const lane = (id: string) => bars.find((b) => b.event.id === id)!.lane;
    expect(lane("A")).toBe(0);
    expect(lane("B")).toBe(1);
    // C doesn't overlap A's columns, so it reuses the top lane.
    expect(lane("C")).toBe(0);
  });

  it("ignores single-day timed events and events outside the week", () => {
    expect(
      packWeek(w, [
        timed("meeting", "2026-06-30T09:30:00", "2026-06-30T10:00:00"),
        allDay("later", "2026-08-01"),
      ]),
    ).toEqual([]);
  });

  it("normalises an event whose end precedes its start", () => {
    const bar = packWeek(w, [allDay("backwards", "2026-07-02", "2026-06-30")])[0];
    expect(bar).toMatchObject({ colStart: 1, span: 3 });
  });
});

describe("packDay", () => {
  const DAY = new Date("2026-07-02T00:00:00");
  /** A timed event on the test day, from clock times. */
  const on = (id: string, start: string, end?: string) =>
    timed(id, `2026-07-02T${start}:00`, end ? `2026-07-02T${end}:00` : undefined);
  /** `{ id: [startHour, endHour, col, cols] }`, for compact expectations. */
  const boxes = (evs: CalEvent[]) =>
    Object.fromEntries(
      packDay(evs, DAY).map((s) => [s.event.id, [s.startHour, s.endHour, s.col, s.cols]]),
    );

  it("positions a block by fractional hours from midnight", () => {
    expect(boxes([on("A", "09:30", "11:00")])).toEqual({ A: [9.5, 11, 0, 1] });
  });

  it("gives an event with no end a nominal half hour", () => {
    expect(boxes([on("A", "09:00")])).toEqual({ A: [9, 9.5, 0, 1] });
  });

  it("floors a zero-length event at half an hour so it stays clickable", () => {
    expect(boxes([on("A", "09:00", "09:00")])).toEqual({ A: [9, 9.5, 0, 1] });
  });

  it("leaves separate events at full width", () => {
    expect(boxes([on("A", "09:00", "10:00"), on("B", "14:00", "15:00")])).toEqual({
      A: [9, 10, 0, 1],
      B: [14, 15, 0, 1],
    });
  });

  it("splits two overlapping events side by side", () => {
    expect(boxes([on("A", "09:00", "11:00"), on("B", "10:00", "12:00")])).toEqual({
      A: [9, 11, 0, 2],
      B: [10, 12, 1, 2],
    });
  });

  it("splits three simultaneous events into thirds", () => {
    expect(
      boxes([on("A", "09:00", "12:00"), on("B", "09:30", "12:00"), on("C", "10:00", "12:00")]),
    ).toEqual({
      A: [9, 12, 0, 3],
      B: [9.5, 12, 1, 3],
      C: [10, 12, 2, 3],
    });
  });

  it("widens a cluster only to its busiest moment, not to its member count", () => {
    // C is chained to A through B, so all three share one cluster — but A has
    // already ended when C starts, so C reuses A's column and two are enough.
    expect(
      boxes([on("A", "09:00", "10:00"), on("B", "09:30", "12:00"), on("C", "10:30", "11:00")]),
    ).toEqual({
      A: [9, 10, 0, 2],
      B: [9.5, 12, 1, 2],
      C: [10.5, 11, 0, 2],
    });
  });

  it("keeps clusters independent, so one pile-up doesn't narrow the rest of the day", () => {
    expect(
      boxes([on("A", "09:00", "10:00"), on("B", "09:00", "10:00"), on("C", "14:00", "15:00")]),
    ).toEqual({
      A: [9, 10, 0, 2],
      B: [9, 10, 1, 2],
      C: [14, 15, 0, 1],
    });
  });

  it("lets a block that starts exactly when another ends reuse its column", () => {
    expect(boxes([on("A", "09:00", "10:00"), on("B", "10:00", "11:00")])).toEqual({
      A: [9, 10, 0, 1],
      B: [10, 11, 0, 1],
    });
  });

  it("orders equal starts by length then title, so columns don't shuffle", () => {
    const ids = packDay([on("Zulu", "09:00", "10:00"), on("Alpha", "09:00", "11:00")], DAY).map(
      (s) => s.event.id,
    );
    expect(ids).toEqual(["Alpha", "Zulu"]);
  });

  it("excludes spanning events — they belong to the all-day strip", () => {
    expect(
      packDay(
        [
          allDay("holiday", "2026-07-02"),
          timed("overnight", "2026-07-02T22:00:00", "2026-07-03T02:00:00"),
        ],
        DAY,
      ),
    ).toEqual([]);
  });

  it("ignores events on other days", () => {
    expect(packDay([on("A", "09:00", "10:00")], new Date("2026-07-03T00:00:00"))).toEqual([]);
  });
});

describe("toWeeks", () => {
  it("splits the grid run into rows of seven", () => {
    const days = eachDayOfInterval({
      start: new Date("2026-06-29T00:00:00"),
      end: new Date("2026-08-02T00:00:00"),
    });
    const weeks = toWeeks(days);
    expect(weeks).toHaveLength(5);
    expect(weeks.every((wk) => wk.length === 7)).toBe(true);
  });
});
