// @vitest-environment jsdom
/**
 * The calendar's right-click menus are the only way to create and delete events
 * from the grid now that the month cells carry no hover buttons, so the wiring
 * is worth pinning down: which menu a right-click opens (innermost wins), that
 * Delete reaches the service, and that Create targets the day clicked.
 *
 * Dates are derived from "today" because the view's cursor starts there
 * (`viewState.calendarCursor`), so the fixtures always land in the month the
 * grid actually renders.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { format, set, startOfDay } from "date-fns";
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

/** A timed event on today, and a second day in the same month to create on
 *  (never the 1st — that cell renders "1 Jul", not a bare number). */
const TODAY = startOfDay(new Date());
const OTHER = set(TODAY, { date: TODAY.getDate() === 15 ? 16 : 15 });
const EVENT: CalEvent = {
  id: "e1",
  title: "Zoom sync",
  start: set(TODAY, { hours: 9, minutes: 30 }).toISOString(),
  end: set(TODAY, { hours: 10, minutes: 30 }).toISOString(),
  all_day: false,
  note_ids: [],
  color: null,
};

/** The `.calendar-cell` for a day of the shown month — found by its day number,
 *  skipping the dimmed leading/trailing days of the neighbouring months. */
function dayCell(day: number) {
  const num = screen
    .getAllByText(String(day))
    .find((el) => el.className === "calendar-daynum" && !el.closest(".calendar-cell.dim"));
  return num!.closest(".calendar-cell") as HTMLElement;
}

describe("calendar context menus", () => {
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
    // Radix menus focus/scroll their items on open; jsdom has no layout engine.
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
  });

  // Vitest runs without `globals`, so testing-library's automatic afterEach
  // cleanup isn't registered — without this, one test's grid stays mounted and
  // the next one queries both.
  afterEach(cleanup);

  async function renderCalendar() {
    render(<CalendarView onOpenNote={() => {}} onError={() => {}} />);
    await screen.findByText("Zoom sync");
  }

  it("opens the day menu on a cell and the event menu on an event — never both", async () => {
    await renderCalendar();
    const cell = dayCell(TODAY.getDate());

    fireEvent.contextMenu(cell);
    expect(await screen.findByText("New event")).toBeTruthy();
    expect(screen.getByText("Link a note to this day")).toBeTruthy();
    expect(screen.queryByText("Delete event")).toBeNull();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("New event")).toBeNull());

    fireEvent.contextMenu(cell.querySelector(".calendar-event-row") as HTMLElement);
    expect(await screen.findByText("Delete event")).toBeTruthy();
    expect(screen.getByText("Edit event…")).toBeTruthy();
    // The cell's menu sits behind this one; stopPropagation must keep it shut.
    expect(screen.queryByText("New event")).toBeNull();
  });

  it("deletes through the service and refreshes the grid", async () => {
    await renderCalendar();
    const row = dayCell(TODAY.getDate()).querySelector(".calendar-event-row") as HTMLElement;

    fireEvent.contextMenu(row);
    const item = await screen.findByText("Delete event");
    range.mockResolvedValue({ events: [], note_dates: [] });
    fireEvent.click(item);

    await waitFor(() => expect(deleteEvent).toHaveBeenCalledWith("e1"));
    await waitFor(() => expect(screen.queryByText("Zoom sync")).toBeNull());
  });

  it("creates at the hour the week grid was right-clicked", async () => {
    await renderCalendar();
    fireEvent.click(screen.getByText("Week"));

    // 3.5rem per hour at the jsdom-default 16px rem = 56px; 800px down the
    // column is 14:00. The column's rect is all-zero in jsdom, so clientY is
    // the offset directly.
    const column = document.querySelector(".calendar-week-daycol") as HTMLElement;
    fireEvent.contextMenu(column, { clientY: 800 });
    fireEvent.click(await screen.findByText("New event"));

    // The dialog's start time field, not the hour gutter behind it — which
    // shows "14:00" too.
    const dialog = await screen.findByRole("dialog");
    const start = dialog.querySelector<HTMLInputElement>("input.time-field")!;
    expect(start.value).toMatch(/^(14:00|2:00 PM)$/);
  });

  it("creates on the day that was right-clicked", async () => {
    await renderCalendar();

    fireEvent.contextMenu(dayCell(OTHER.getDate()));
    fireEvent.click(await screen.findByText("New event"));

    // The event dialog opens on that day — its summary line names it.
    expect(await screen.findByText(format(OTHER, "EEEE, MMM d"))).toBeTruthy();
    expect(screen.getByText("Create")).toBeTruthy();
  });
});
