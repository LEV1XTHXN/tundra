// @vitest-environment jsdom
/**
 * Sweeping across the week view's day headers. It's the horizontal twin of the
 * hour grid's drag (WeekDragCreate.test.tsx): press on a day name, sweep
 * sideways, release, and the dialog opens on an ALL-DAY event over exactly those
 * days — headers name days, not hours.
 *
 * The one thing that has to hold beyond the span itself: a plain click still
 * does nothing. The headers were inert before, and a stray click that silently
 * created an event would be worse than the feature is good.
 *
 * jsdom reports all-zero rects, so the columns are given explicit ones here —
 * the view reads them to decide which day the pointer is over.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { addDays, format, parseISO, startOfDay, startOfWeek } from "date-fns";
import type { Event as CalEvent } from "@/services";
import "@/i18n";

const range = vi.fn();
const createEvent = vi.fn(async (_e: CalEvent) => null);

vi.mock("@/services", () => ({
  calendar: {
    range: (start: string, end: string) => range(start, end),
    createEvent: (e: CalEvent) => createEvent(e),
    updateEvent: vi.fn(async () => null),
    deleteEvent: vi.fn(async () => null),
    deleteEventOccurrence: vi.fn(async () => null),
    removeNoteDate: vi.fn(async () => null),
    addNoteDate: vi.fn(async () => null),
  },
  notes: { list: vi.fn(async () => []) },
  appSettings: { get: vi.fn(async () => null), set: vi.fn(async () => null) },
}));

const { CalendarView } = await import("./CalendarView");

const MONDAY = startOfWeek(startOfDay(new Date()), { weekStartsOn: 1 });
const dayKey = (d: Date) => format(d, "yyyy-MM-dd");
/** The LOCAL day an ISO instant falls on. An all-day event is stored as local
 *  midnight in UTC, so its ISO string's own date is a day early east of UTC —
 *  the grids read it back the same way (`byDay`). */
const localDay = (iso: string) => format(parseISO(iso), "yyyy-MM-dd");

/** Column width in the faked layout — column `n` spans `[n*100, (n+1)*100)`. */
const COL = 100;
const midOf = (col: number) => col * COL + COL / 2;

const heads = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".calendar-week-daycol-head"));

/** Give the seven headers real rects; jsdom's are all zero. */
function layOutHeads() {
  heads().forEach((el, i) => {
    el.getBoundingClientRect = () =>
      ({ left: i * COL, right: (i + 1) * COL, top: 0, bottom: 56, width: COL, height: 56 }) as DOMRect;
  });
}

describe("week view day-header sweep", () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
    range.mockResolvedValue({ events: [], note_dates: [] });
  });
  afterEach(cleanup);

  async function renderWeek() {
    render(<CalendarView onOpenNote={() => {}} onError={() => {}} />);
    await waitFor(() => expect(range).toHaveBeenCalled());
    fireEvent.click(screen.getByText("Week"));
    await waitFor(() => expect(heads()).toHaveLength(7));
    layOutHeads();
  }

  /** Press on one day column and release over another. */
  function sweep(from: number, to: number) {
    fireEvent.mouseDown(heads()[from], { button: 0, clientX: midOf(from) });
    fireEvent.mouseMove(document.body, { clientX: midOf(to) });
    fireEvent.mouseUp(document.body, { clientX: midOf(to) });
  }

  /** The event the dialog would create, once Create is pressed. */
  async function created() {
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    return createEvent.mock.calls[0][0];
  }

  it("creates an all-day event over the days swept", async () => {
    await renderWeek();

    sweep(0, 2);

    const payload = await created();
    expect(payload.all_day).toBe(true);
    expect(localDay(payload.start)).toBe(dayKey(MONDAY));
    expect(localDay(payload.end!)).toBe(dayKey(addDays(MONDAY, 2)));
  });

  it("normalizes a sweep made right to left", async () => {
    await renderWeek();

    sweep(4, 1);

    const payload = await created();
    expect(localDay(payload.start)).toBe(dayKey(addDays(MONDAY, 1)));
    expect(localDay(payload.end!)).toBe(dayKey(addDays(MONDAY, 4)));
  });

  it("opens the dialog with All day already ticked", async () => {
    await renderWeek();

    // A sweep that never leaves its own column: one day, still all-day.
    fireEvent.mouseDown(heads()[1], { button: 0, clientX: midOf(1) });
    fireEvent.mouseMove(document.body, { clientX: midOf(1) + 20 });
    fireEvent.mouseUp(document.body, { clientX: midOf(1) + 20 });

    const dialog = await screen.findByRole("dialog");
    const allDay = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(allDay.checked).toBe(true);
    // A day named without hours: the time fields have nothing to say.
    for (const field of dialog.querySelectorAll<HTMLInputElement>("input.time-field")) {
      expect(field.disabled).toBe(true);
    }
  });

  it("previews the span while sweeping, then clears it", async () => {
    await renderWeek();

    fireEvent.mouseDown(heads()[1], { button: 0, clientX: midOf(1) });
    // Nothing is marked until the press becomes a drag.
    expect(document.querySelectorAll(".calendar-week-daycol-head.selecting")).toHaveLength(0);

    fireEvent.mouseMove(document.body, { clientX: midOf(3) });
    expect(document.querySelectorAll(".calendar-week-daycol-head.selecting")).toHaveLength(3);

    fireEvent.mouseUp(document.body, { clientX: midOf(3) });
    expect(document.querySelectorAll(".calendar-week-daycol-head.selecting")).toHaveLength(0);
  });

  it("does nothing on a plain click, as the headers always have", async () => {
    await renderWeek();

    fireEvent.mouseDown(heads()[2], { button: 0, clientX: midOf(2) });
    fireEvent.mouseUp(document.body, { clientX: midOf(2) });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("leaves the right-click menu alone", async () => {
    await renderWeek();

    fireEvent.mouseDown(heads()[2], { button: 2, clientX: midOf(2) });
    fireEvent.contextMenu(heads()[2]);

    expect(await screen.findByText("New event")).toBeTruthy();
  });
});
