// @vitest-environment jsdom
/**
 * The shell sidebar's mini month: the dot on a day that carries something, and
 * the drill-in it drives.
 *
 * Clicking a day opens that day's WEEK in the main grid, exactly like clicking a
 * month cell does.
 *
 * The mode switch is the whole point. Moving the cursor alone — what the sidebar
 * used to do — is invisible in month mode, because the grid is drawn from the
 * cursor's *month* and every day of the shown month yields the same one. So the
 * click has to move both halves of the shared state (`calendarCursor` +
 * `calendarMode`), which is why the mode lives in `useViewState` at all.
 *
 * The clicked day is read out of the rendered mini grid rather than computed, so
 * the test holds in every month regardless of where the weeks fall.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { addDays, format, set, startOfDay, startOfMonth } from "date-fns";
import type { Event as CalEvent } from "@/services";
import "@/i18n";

const range = vi.fn();
const deleteEvent = vi.fn(async (_id: string) => null);

vi.mock("@/services", () => ({
  calendar: {
    range: (start: string, end: string) => range(start, end),
    deleteEvent: (id: string) => deleteEvent(id),
    createEvent: vi.fn(async () => null),
    updateEvent: vi.fn(async () => null),
    removeNoteDate: vi.fn(async () => null),
    addNoteDate: vi.fn(async () => null),
  },
  notes: { list: vi.fn(async () => []) },
  appSettings: { get: vi.fn(async () => null), set: vi.fn(async () => null) },
}));

const { CalendarView } = await import("./CalendarView");
const { CalendarSidebar } = await import("./CalendarSidebar");
const { useViewState } = await import("@/store/viewState");

const miniDays = () => Array.from(document.querySelectorAll<HTMLElement>(".mini-calendar-day"));
const weekColumns = () => document.querySelectorAll(".calendar-week-daycol");
/** The day numbers heading week mode's seven columns. */
const weekHeadNums = () =>
  Array.from(
    document.querySelectorAll(".calendar-week-daycol-head .calendar-daynum"),
    (el) => el.textContent,
  );

/** A dotted day is one the marks query put an event on. Anchored to the 10th of
 *  the shown month, so the fixture always lands in the grid. */
const TENTH = addDays(startOfMonth(startOfDay(new Date())), 9);
const marked = (id: string, start: Date, end?: Date): CalEvent => ({
  id,
  title: id,
  start: start.toISOString(),
  end: end ? end.toISOString() : null,
  all_day: true,
  note_ids: [],
  color: null,
});
/** The same, timed — the month grid draws it as a clickable `.calendar-event-row`
 *  rather than an all-day bar. */
const timed = (id: string, start: Date): CalEvent => ({
  ...marked(id, set(start, { hours: 9, minutes: 30 })),
  end: set(start, { hours: 10, minutes: 30 }).toISOString(),
  all_day: false,
});

/** The day numbers the mini month has dotted. */
const dotted = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(".mini-calendar-day.has-events"),
    (el) => el.querySelector(".mini-calendar-daynum")!.textContent,
  );

describe("sidebar mini month", () => {
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
    // The month grid sizes each cell's row capacity from the measured body
    // height — 0 in jsdom, which would collapse every day into "+N more".
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      value: 900,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    range.mockResolvedValue({ events: [], note_dates: [] });
    // Mode and cursor are shared app state, so a test that moved either would
    // otherwise hand the next one a different grid.
    useViewState.getState().setCalendarMode("month");
    useViewState.getState().setCalendarCursor(new Date());
  });

  afterEach(cleanup);

  /** Both surfaces mounted together, as the shell mounts them. */
  async function renderShell() {
    render(
      <>
        <CalendarSidebar />
        <CalendarView onOpenNote={() => {}} onError={() => {}} />
      </>,
    );
    await waitFor(() => expect(miniDays().length).toBeGreaterThan(0));
  }

  it("dots the days that carry an event, and only those", async () => {
    // The dot itself is a `::after` on `.has-events` (index.css) — jsdom has no
    // layout, so what's pinned here is which days earn the class.
    range.mockResolvedValue({
      events: [marked("One-day", TENTH), marked("Period", addDays(TENTH, 2), addDays(TENTH, 4))],
      note_dates: [],
    });
    await renderShell();

    // A multi-day event dots every day it covers, not just its first.
    const expected = [TENTH, ...[2, 3, 4].map((n) => addDays(TENTH, n))].map((d) => format(d, "d"));
    await waitFor(() => expect(dotted()).toEqual(expected));
  });

  it("re-dots as soon as the view writes, without leaving the calendar", async () => {
    // The mini month and the grid are siblings fetching separately, so a write in
    // one reaches the other only through `calendarRevision`. Without that bump
    // the dot survives until something remounts the month — which, in the app,
    // means switching views and coming back.
    range.mockResolvedValue({ events: [timed("Zoom sync", TENTH)], note_dates: [] });
    await renderShell();
    await waitFor(() => expect(dotted()).toEqual([format(TENTH, "d")]));

    // Delete it through the grid's own path: right-click the row, confirm.
    range.mockResolvedValue({ events: [], note_dates: [] });
    fireEvent.contextMenu(document.querySelector(".calendar-event-row")!);
    fireEvent.click(await screen.findByText("Delete event"));

    await waitFor(() => expect(deleteEvent).toHaveBeenCalledWith("Zoom sync"));
    await waitFor(() => expect(dotted()).toEqual([]));
  });

  it("opens the clicked day's week in the main grid", async () => {
    await renderShell();
    // A day in a DIFFERENT row from today's — the mini month's rows are weeks,
    // so this guarantees the grid has to move somewhere new. Clicking today's
    // own week would prove nothing: that's the week week-mode opens on anyway.
    const cells = miniDays();
    const todayRow = Math.floor(cells.findIndex((c) => c.className.includes("today")) / 7);
    const cell = cells.find(
      (c, i) => Math.floor(i / 7) !== todayRow && !c.className.includes("dim"),
    )!;
    const dayNum = cell.querySelector(".mini-calendar-daynum")!.textContent;

    fireEvent.click(cell);

    await waitFor(() => expect(weekColumns()).toHaveLength(7));
    expect(weekHeadNums()).toContain(dayNum);
    expect(useViewState.getState().calendarMode).toBe("week");
  });

  it("leaves the mode alone when the month arrows page", async () => {
    await renderShell();

    const month = () => document.querySelector(".mini-calendar-month")!.textContent;
    const before = month();

    // The header's first button is ‹ (previous month).
    fireEvent.click(document.querySelector(".mini-calendar-header button")!);

    // Paging is not picking a day: the main grid stays a month, on the new one.
    await waitFor(() => expect(month()).not.toBe(before));
    expect(useViewState.getState().calendarMode).toBe("month");
    expect(weekColumns()).toHaveLength(0);
  });
});
