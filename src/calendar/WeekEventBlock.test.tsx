// @vitest-environment jsdom
/**
 * The week grid's timed event block. Three rules under test, all of them what
 * separates the block from a bare coloured rectangle:
 *
 * - it says WHEN, not just what;
 * - the time sits beside the title on a block too short for two lines, and under
 *   it otherwise (`SHORT_EVENT_MINUTES`);
 * - overlapping events split the column between them instead of stacking.
 *
 * The column maths itself is `packDay`, unit-tested in monthLayout.test.ts; this
 * file pins the view's half — that the geometry reaches the DOM as inline styles
 * and the two text nodes land in the right shape.
 *
 * Dates are derived from the Monday of the current week, as in WeekAllDay: the
 * cursor starts at today, so fixtures anchored this way land in the rendered week.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const MONDAY = startOfWeek(startOfDay(new Date()), { weekStartsOn: 1 });
/** Monday at a clock time — every fixture lives on the one day. */
const at = (hours: number, minutes = 0) =>
  set(addDays(MONDAY, 0), { hours, minutes, seconds: 0, milliseconds: 0 }).toISOString();

const event = (id: string, start: string, end: string | null = null): CalEvent => ({
  id,
  title: id,
  start,
  end,
  all_day: false,
  note_ids: [],
  color: null,
});

const blocks = () => Array.from(document.querySelectorAll<HTMLElement>(".calendar-week-event"));
const block = (n = 0) => blocks()[n];
const titleOf = (el: HTMLElement) => el.querySelector(".calendar-week-event-title")?.textContent;
const timeOf = (el: HTMLElement) => el.querySelector(".calendar-week-event-time")?.textContent;

describe("week view event block", () => {
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

  async function renderWeek(events: CalEvent[]) {
    range.mockResolvedValue({ events, note_dates: [] });
    render(<CalendarView onOpenNote={() => {}} onError={() => {}} />);
    fireEvent.click(screen.getByText("Week"));
    await waitFor(() => expect(blocks().length).toBe(events.length));
  }

  it("puts the time under the title on a block tall enough for two lines", async () => {
    await renderWeek([event("Lab Work", at(9, 20), at(15))]);

    expect(block().className).not.toMatch(/compact/);
    expect(titleOf(block())).toBe("Lab Work");
    expect(timeOf(block())).toMatch(/^(09:20 – 15:00|9:20 AM – 3:00 PM)$/);
  });

  it("puts the start time BESIDE the title on a short block", async () => {
    await renderWeek([event("Standup", at(9), at(9, 30))]);

    expect(block().className).toMatch(/compact/);
    expect(titleOf(block())).toBe("Standup");
    // Start only: an end time would not fit on the one line a 28px block has.
    expect(timeOf(block())).toMatch(/^(09:00|9:00 AM)$/);
  });

  it("keeps the whole span in the tooltip, which the block itself may clip", async () => {
    await renderWeek([event("Standup", at(9), at(9, 30))]);

    expect(block().title).toMatch(/^Standup · (09:00 – 09:30|9:00 AM – 9:30 AM)$/);
  });

  it("gives a lone event the full column, one pixel shy of the rule", async () => {
    await renderWeek([event("Lab Work", at(9), at(11))]);

    expect(block().style.left).toBe("0%");
    expect(block().style.width).toBe("calc(100% - 1px)");
    expect(block().style.top).toBe("31.5rem");
    expect(block().style.height).toBe("7rem");
  });

  it("splits overlapping events side by side instead of stacking them", async () => {
    await renderWeek([event("A", at(9), at(11)), event("B", at(10), at(12))]);

    expect(block(0).style.left).toBe("0%");
    expect(block(1).style.left).toBe("50%");
    for (const b of blocks()) expect(b.style.width).toBe("calc(50% - 1px)");
  });

  it("falls back to the nominal half hour when an event has no end", async () => {
    await renderWeek([event("Reminder", at(9))]);

    expect(block().style.height).toBe("1.75rem");
    expect(timeOf(block())).toMatch(/^(09:00|9:00 AM)$/);
  });
});
