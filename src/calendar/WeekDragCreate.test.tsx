// @vitest-environment jsdom
/**
 * Dragging a time slot in week mode. Press in a day column, sweep, release, and
 * the event dialog opens pre-filled with exactly that span — snapped to 15
 * minutes, in both drag directions, while the grid itself keeps drawing nothing
 * but hour rules.
 *
 * The geometry is testable because jsdom reports all-zero rects: `clientY` IS
 * the offset into the column, and 3.5rem × 16px = 56px per hour. (Same trick as
 * CalendarContextMenu.test.tsx's right-click-at-an-hour case.)
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { set, startOfDay, startOfWeek } from "date-fns";
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

/** Monday of the week the grid shows — the cursor starts at today, so anchoring
 *  the fixture here keeps it inside the rendered week. */
const MONDAY = startOfWeek(startOfDay(new Date()), { weekStartsOn: 1 });
/** A timed event on Monday, to press ON (drags must not start on an event). */
const EVENT: CalEvent = {
  id: "e1",
  title: "Zoom sync",
  start: set(MONDAY, { hours: 9, minutes: 0 }).toISOString(),
  end: set(MONDAY, { hours: 10, minutes: 0 }).toISOString(),
  all_day: false,
  note_ids: [],
  color: null,
};

/** Pixels down a day column for a wall-clock time — the inverse of the view's
 *  `HOUR_HEIGHT_REM` maths at jsdom's default 16px rem. */
const px = (hours: number, minutes = 0) => (hours + minutes / 60) * 56;

const column = (n = 0) =>
  document.querySelectorAll<HTMLElement>(".calendar-week-daycol")[n];
const draft = () => document.querySelector<HTMLElement>(".calendar-week-draft");

describe("week view drag-to-create", () => {
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
    range.mockResolvedValue({ events: [EVENT], note_dates: [] });
  });

  afterEach(cleanup);

  async function renderWeek() {
    render(<CalendarView onOpenNote={() => {}} onError={() => {}} />);
    fireEvent.click(screen.getByText("Week"));
    await screen.findByText("Zoom sync");
  }

  /** Sweep from one offset to another in a day column. Moves and the release go
   *  to `document.body`, which is what a drag leaving the column does — they
   *  reach the view's window listeners by bubbling. */
  function sweep(from: number, to: number, col = column()) {
    fireEvent.mouseDown(col, { button: 0, clientY: from });
    fireEvent.mouseMove(document.body, { clientY: to });
    fireEvent.mouseUp(document.body, { clientY: to });
  }

  /** The dialog's Start and End, as the pickers render them. */
  async function dialogTimes() {
    const dialog = await screen.findByRole("dialog");
    return within(dialog)
      .getAllByText(/\d{1,2}:\d{2}( [AP]M)?$/)
      .map((el) => el.textContent);
  }

  it("opens the dialog on the dragged span, snapped to 15 minutes", async () => {
    await renderWeek();

    // 10:00 down to 12:30-and-a-bit: the slot under the pointer is included, so
    // the span ends at 12:45.
    sweep(px(10), px(12, 38));

    const [start, end] = await dialogTimes();
    expect(start).toMatch(/(10:00|10:00 AM)$/);
    expect(end).toMatch(/(12:45|12:45 PM)$/);
  });

  it("normalizes a drag made upwards", async () => {
    await renderWeek();

    sweep(px(12, 38), px(10));

    const [start, end] = await dialogTimes();
    expect(start).toMatch(/(10:00|10:00 AM)$/);
    expect(end).toMatch(/(12:45|12:45 PM)$/);
  });

  it("previews the span while dragging, then clears it", async () => {
    await renderWeek();

    fireEvent.mouseDown(column(), { button: 0, clientY: px(10) });
    // Nothing is drawn until the press becomes a drag.
    expect(draft()).toBeNull();

    fireEvent.mouseMove(document.body, { clientY: px(12, 38) });
    expect(draft()!.textContent).toMatch(/^(10:00|10:00 AM) – (12:45|12:45 PM)$/);
    // 10:00 is 10 × 3.5rem down; 2h45m spans 2.75 × 3.5rem.
    expect(draft()!.style.top).toBe("35rem");
    expect(draft()!.style.height).toBe("9.625rem");

    fireEvent.mouseUp(document.body, { clientY: px(12, 38) });
    expect(draft()).toBeNull();
  });

  it("treats a press that never moves as a one-hour event at the snapped mark", async () => {
    await renderWeek();

    // 09:47 — inside the 09:00 row, but the 09:45 slot.
    fireEvent.mouseDown(column(), { button: 0, clientY: px(9, 47) });
    fireEvent.mouseUp(document.body, { clientY: px(9, 47) });

    const [start, end] = await dialogTimes();
    expect(start).toMatch(/(9:45|9:45 AM)$/);
    expect(end).toMatch(/(10:45|10:45 AM)$/);
  });

  it("ignores the hour button's own mouse click, so one press opens one dialog", async () => {
    await renderWeek();

    fireEvent.mouseDown(column(), { button: 0, clientY: px(9, 47) });
    fireEvent.mouseUp(document.body, { clientY: px(9, 47) });
    // The click a real browser sends after the mouseup lands on the hour slot
    // the press was over. It must not open a second, hour-aligned dialog.
    fireEvent.click(column().querySelectorAll(".calendar-hour-slot")[9], { detail: 1 });

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect((await dialogTimes())[0]).toMatch(/(9:45|9:45 AM)$/);
  });

  it("starts no drag when the press lands on an existing event", async () => {
    await renderWeek();

    const block = document.querySelector(".calendar-week-event") as HTMLElement;
    fireEvent.mouseDown(block, { button: 0, clientY: px(9, 30) });
    fireEvent.mouseMove(document.body, { clientY: px(12) });
    expect(draft()).toBeNull();

    // The block's own click still opens it for editing.
    fireEvent.mouseUp(document.body, { clientY: px(12) });
    fireEvent.click(block, { detail: 1 });
    await waitFor(() => expect(screen.getByText("Edit event")).toBeTruthy());
  });
});
