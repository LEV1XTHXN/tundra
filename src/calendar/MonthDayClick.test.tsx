// @vitest-environment jsdom
/**
 * Drilling from month into week: left-clicking a day cell switches the calendar
 * to week mode on THAT day's week. The subtlety worth pinning is the guard —
 * the cell is one big click target that also contains buttons (event rows, note
 * links, "+N more"), and their clicks bubble through it, so the drill-in must
 * not fire underneath a dialog the same click just opened.
 *
 * The clicked day is read out of the rendered grid rather than computed, so the
 * test holds in every month regardless of where the weeks fall.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { set, startOfDay } from "date-fns";
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
const { useViewState } = await import("@/store/viewState");

const TODAY = startOfDay(new Date());
const EVENT: CalEvent = {
  id: "e1",
  title: "Zoom sync",
  start: set(TODAY, { hours: 9, minutes: 30 }).toISOString(),
  end: set(TODAY, { hours: 10, minutes: 30 }).toISOString(),
  all_day: false,
  note_ids: [],
  color: null,
};

const weekColumns = () => document.querySelectorAll(".calendar-week-daycol");
/** The day numbers heading week mode's seven columns. */
const weekHeadNums = () =>
  Array.from(
    document.querySelectorAll(".calendar-week-daycol-head .calendar-daynum"),
    (el) => el.textContent,
  );

describe("month → week drill-in", () => {
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
    range.mockResolvedValue({ events: [EVENT], note_dates: [] });
    // The cursor is shared app state, so a test that moved it would otherwise
    // hand the next one a different month.
    useViewState.getState().setCalendarCursor(new Date());
  });

  afterEach(cleanup);

  async function renderCalendar() {
    render(<CalendarView onOpenNote={() => {}} onError={() => {}} />);
    await screen.findByText("Zoom sync");
  }

  it("switches to week mode on the clicked day's week", async () => {
    await renderCalendar();
    // A day of the shown month outside today's week — clicking today's own week
    // would prove nothing, since that's the week week-mode opens on anyway.
    // The 1st is skipped too: its cell reads "1 Jul", not a bare number.
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(".calendar-cell"))
      .filter((c) => !c.className.includes("dim"))
      .filter((c) => !c.closest(".calendar-week-row")!.querySelector(".calendar-cell.today"))
      .filter((c) => /^\d+$/.test(c.querySelector(".calendar-daynum")!.textContent ?? ""));
    const cell = candidates[candidates.length - 1];
    const dayNum = cell.querySelector(".calendar-daynum")!.textContent;

    fireEvent.click(cell);

    await waitFor(() => expect(weekColumns()).toHaveLength(7));
    expect(weekHeadNums()).toContain(dayNum);
  });

  it("leaves month mode alone when the click lands on an event row", async () => {
    await renderCalendar();
    const row = document.querySelector(".calendar-event-row") as HTMLElement;

    fireEvent.click(row);

    // The event's dialog opens, and the grid behind it is still the month.
    expect(await screen.findByText("Edit event")).toBeTruthy();
    expect(weekColumns()).toHaveLength(0);
  });
});
