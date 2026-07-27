// @vitest-environment jsdom
/**
 * Week mode's all-day strip. The rule under test: an event covering more than
 * one day is ONE bar stretched across those days at the top — never a chip per
 * column, and never blocks running down each day's hour grid. That split is
 * `isSpanning`, and the bar geometry comes from `packWeek` (both in
 * monthLayout.ts, unit-tested there); this file pins the view's half — that the
 * week grid actually routes events to the right place and spans the right
 * columns.
 *
 * Dates are derived from the Monday of the current week: the view's cursor
 * starts at today (`viewState.calendarCursor`), so fixtures anchored this way
 * always land in the week the grid renders.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { addDays, set, startOfDay, startOfWeek } from "date-fns";
import type { Event as CalEvent } from "@/services";
import "@/i18n";

const range = vi.fn();

vi.mock("@/services", () => ({
  calendar: {
    range: (start: string, end: string) => range(start, end),
    deleteEvent: vi.fn(async () => null),
    createEvent: vi.fn(async () => null),
    updateEvent: vi.fn(async () => null),
    removeNoteDate: vi.fn(async () => null),
    addNoteDate: vi.fn(async () => null),
  },
  notes: { list: vi.fn(async () => []) },
  appSettings: { get: vi.fn(async () => null), set: vi.fn(async () => null) },
}));

const { CalendarView } = await import("./CalendarView");

/** Monday of the week the grid shows, and `n` days on from it. */
const MONDAY = startOfWeek(startOfDay(new Date()), { weekStartsOn: 1 });
const day = (n: number) => addDays(MONDAY, n);
/** `n` days on from Monday, at a clock time. */
const at = (n: number, hours: number) => set(day(n), { hours, minutes: 0 }).toISOString();

const event = (e: Partial<CalEvent> & { id: string }): CalEvent => ({
  title: e.id,
  start: at(0, 9),
  end: null,
  all_day: false,
  note_ids: [],
  color: null,
  ...e,
});

const bars = () => Array.from(document.querySelectorAll<HTMLElement>(".calendar-week-alldaylane .calendar-allday-bar"));
const blocks = () => Array.from(document.querySelectorAll<HTMLElement>(".calendar-week-event"));

describe("week view all-day strip", () => {
  beforeAll(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      onchange: null,
      dispatchEvent: () => false,
    }));
    Element.prototype.scrollIntoView = () => {};
  });

  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  /** Render with `events` loaded, then switch to week mode and wait for the
   *  loaded events to reach the grid — as a bar, a block, or both. */
  async function renderWeek(events: CalEvent[]) {
    range.mockResolvedValue({ events, note_dates: [] });
    render(<CalendarView onOpenNote={() => {}} onError={() => {}} />);
    fireEvent.click(screen.getByText("Week"));
    await waitFor(() => expect(bars().length + blocks().length).toBeGreaterThan(0));
  }

  it("stretches a multi-day all-day event into one bar across its days", async () => {
    await renderWeek([
      event({ id: "Conference", all_day: true, start: at(0, 0), end: at(2, 0) }),
    ]);

    expect(bars()).toHaveLength(1);
    expect(bars()[0].style.gridColumn).toBe("1 / span 3");
    // Mon–Wed sits inside the week: neither edge is a cut.
    expect(bars()[0].className).not.toMatch(/continues-/);
  });

  it("moves a multi-day TIMED event out of the hour grid and into the strip", async () => {
    await renderWeek([
      event({ id: "Offsite", start: at(0, 14), end: at(2, 10) }),
    ]);

    expect(bars()).toHaveLength(1);
    expect(bars()[0].style.gridColumn).toBe("1 / span 3");
    // The old behaviour: 14:00→24:00, all of Tuesday, 00:00→10:00 as blocks.
    expect(blocks()).toHaveLength(0);
  });

  it("leaves a same-day timed event in the hour grid", async () => {
    await renderWeek([event({ id: "Zoom sync", start: at(1, 9), end: at(1, 10) })]);

    expect(bars()).toHaveLength(0);
    expect(blocks()).toHaveLength(1);
    // 09:00 for one hour, at HOUR_HEIGHT_REM = 3.5rem per hour.
    expect(blocks()[0].style.top).toBe("31.5rem");
    expect(blocks()[0].style.height).toBe("3.5rem");
  });

  it("squares off a bar that runs in from the previous week", async () => {
    await renderWeek([
      event({ id: "Holiday", all_day: true, start: at(-3, 0), end: at(1, 0) }),
    ]);

    expect(bars()[0].style.gridColumn).toBe("1 / span 2");
    expect(bars()[0].className).toMatch(/continues-left/);
    expect(bars()[0].className).not.toMatch(/continues-right/);
  });

  it("caps the strip's lanes and collapses the rest into a per-day +N more", async () => {
    // Five bars all covering Tuesday — one lane each, two over the cap.
    const stacked = Array.from({ length: 5 }, (_, i) =>
      event({ id: `Period ${i}`, all_day: true, start: at(1, 0), end: at(1 + i, 0) }),
    );
    await renderWeek(stacked);

    expect(bars()).toHaveLength(3);
    const more = screen.getByText("+2 more");

    fireEvent.click(more);
    // The popover lists the whole day, not just the hidden remainder.
    const popover = document.querySelector(".calendar-day-popover") as HTMLElement;
    for (const ev of stacked) expect(within(popover).getByText(ev.title)).toBeTruthy();
  });
});
