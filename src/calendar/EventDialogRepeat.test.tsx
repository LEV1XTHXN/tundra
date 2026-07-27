// @vitest-environment jsdom
/**
 * The reworked event dialog, in the parts that are new: the day comes from the
 * mini month (one click, or two for a span), the times from typed fields, and
 * the repeat from a dropdown — and a repeating event's Delete asks whether it
 * means one day or all of them.
 *
 * What's pinned here is the SHAPE that reaches the service, because that's the
 * contract the Rust core expands from: a `repeat` of the right unit/interval, a
 * start/end built from the picked days plus the typed times, and `occurrence`
 * carried back untouched so the core can re-anchor a series edit.
 *
 * Dates derive from today, as in the sibling calendar tests: the view's cursor
 * starts there, so fixtures always land in the rendered month.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { addDays, format, set, startOfDay } from "date-fns";
import type { Event as CalEvent } from "@/services";
import "@/i18n";

const range = vi.fn();
const createEvent = vi.fn(async (_e: CalEvent) => null);
const updateEvent = vi.fn(async (_e: CalEvent) => null);
const deleteEvent = vi.fn(async (_id: string) => null);
const deleteEventOccurrence = vi.fn(async (_id: string, _date: string) => null);

vi.mock("@/services", () => ({
  calendar: {
    range: (start: string, end: string) => range(start, end),
    createEvent: (e: CalEvent) => createEvent(e),
    updateEvent: (e: CalEvent) => updateEvent(e),
    deleteEvent: (id: string) => deleteEvent(id),
    deleteEventOccurrence: (id: string, date: string) => deleteEventOccurrence(id, date),
    removeNoteDate: vi.fn(async () => null),
    addNoteDate: vi.fn(async () => null),
  },
  notes: { list: vi.fn(async () => []) },
  appSettings: { get: vi.fn(async () => null), set: vi.fn(async () => null) },
}));

const { CalendarView } = await import("./CalendarView");

const TODAY = startOfDay(new Date());
/** A day in the same month that is neither today nor the 1st (whose cell shows
 *  "1 Jul" rather than a bare number). */
const OTHER = set(TODAY, { date: TODAY.getDate() === 15 ? 16 : 15 });
const dayKey = (d: Date) => format(d, "yyyy-MM-dd");

/** An occurrence of a daily series, as `calendar.range` would expand it. */
const OCCURRENCE: CalEvent = {
  id: "series-1",
  title: "Standup",
  start: set(TODAY, { hours: 9, minutes: 0 }).toISOString(),
  end: set(TODAY, { hours: 9, minutes: 30 }).toISOString(),
  all_day: false,
  note_ids: [],
  color: null,
  repeat: { unit: "day", interval: 1, until: null, skip: [] },
  occurrence: dayKey(TODAY),
};

const timeFields = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>("input.time-field"));

/** The `.mini-calendar-day` for a day of the shown month, inside the dialog. */
function monthDay(date: Date) {
  const dialog = screen.getByRole("dialog");
  return within(dialog).getByTitle(format(date, "EEEE, MMM d, yyyy"));
}

describe("event dialog", () => {
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
    // Radix's Select drives itself off pointer capture, which jsdom doesn't
    // implement — without these the dropdown never opens.
    HTMLElement.prototype.hasPointerCapture = () => false;
    HTMLElement.prototype.setPointerCapture = () => {};
    HTMLElement.prototype.releasePointerCapture = () => {};
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      value: 900,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    range.mockResolvedValue({ events: [], note_dates: [] });
  });
  afterEach(cleanup);

  async function openNewEvent() {
    render(<CalendarView onOpenNote={() => {}} onError={() => {}} />);
    await waitFor(() => expect(range).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Event" }));
    return screen.findByRole("dialog");
  }

  /** Pick an entry from the (Radix) Repeat dropdown. Opened by keyboard: the
   *  pointer path needs a layout engine jsdom doesn't have. */
  function chooseRepeat(label: string) {
    fireEvent.keyDown(screen.getByLabelText("Repeat"), { key: " " });
    fireEvent.click(screen.getByRole("option", { name: label }));
  }

  it("sends no repeat unless one is chosen", async () => {
    await openNewEvent();
    fireEvent.click(screen.getByText("Create"));

    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    expect(createEvent.mock.calls[0][0].repeat).toBeNull();
  });

  it("sends the unit and interval the dropdown names", async () => {
    await openNewEvent();
    chooseRepeat("Weekly");
    fireEvent.click(screen.getByText("Create"));

    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    expect(createEvent.mock.calls[0][0].repeat).toMatchObject({ unit: "week", interval: 1 });
  });

  it("sends a custom day span as an interval in days", async () => {
    await openNewEvent();
    chooseRepeat("Every N days…");

    const interval = screen.getByLabelText("Every N days…") as HTMLInputElement;
    // The custom entry opens on 2 — 1 is already the Daily entry above it.
    expect(interval.value).toBe("2");
    fireEvent.change(interval, { target: { value: "3" } });
    fireEvent.click(screen.getByText("Create"));

    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    expect(createEvent.mock.calls[0][0].repeat).toMatchObject({ unit: "day", interval: 3 });
  });

  it("builds the instants from the picked day and the typed times", async () => {
    await openNewEvent();

    fireEvent.click(monthDay(OTHER));
    const [start, end] = timeFields();
    // Typed the way people write times, not as "09:30".
    fireEvent.change(start, { target: { value: "930" } });
    fireEvent.blur(start);
    fireEvent.change(end, { target: { value: "1415" } });
    fireEvent.blur(end);
    fireEvent.click(screen.getByText("Create"));

    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    const payload = createEvent.mock.calls[0][0];
    expect(payload.start).toBe(set(OTHER, { hours: 9, minutes: 30 }).toISOString());
    expect(payload.end).toBe(set(OTHER, { hours: 14, minutes: 15 }).toISOString());
    expect(payload.all_day).toBe(false);
  });

  it("takes a second click in the month as the end of a multi-day span", async () => {
    await openNewEvent();

    fireEvent.click(monthDay(OTHER));
    fireEvent.click(monthDay(addDays(OTHER, 2)));

    await waitFor(() => expect(monthDay(addDays(OTHER, 1)).className).toMatch(/in-range/));
    fireEvent.click(screen.getByText("Create"));

    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    const payload = createEvent.mock.calls[0][0];
    expect(payload.start.slice(0, 10)).toBe(dayKey(OTHER));
    expect(payload.end?.slice(0, 10)).toBe(dayKey(addDays(OTHER, 2)));
  });

  it("greys out both times for an all-day event", async () => {
    await openNewEvent();
    fireEvent.click(screen.getByLabelText("Start time")); // a list would open…
    expect(document.querySelectorAll(".time-field-mark").length).toBeGreaterThan(0);
    fireEvent.keyDown(screen.getByLabelText("Start time"), { key: "Escape" });

    fireEvent.click(screen.getByText("All day"));
    for (const field of timeFields()) expect(field.disabled).toBe(true);

    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    expect(createEvent.mock.calls[0][0].all_day).toBe(true);
  });

  it("carries the occurrence back so the core can re-anchor a series edit", async () => {
    range.mockResolvedValue({ events: [OCCURRENCE], note_dates: [] });
    render(<CalendarView onOpenNote={() => {}} onError={() => {}} />);

    fireEvent.click(await screen.findByTitle("Standup"));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(updateEvent).toHaveBeenCalled());
    const payload = updateEvent.mock.calls[0][0];
    expect(payload.id).toBe("series-1");
    expect(payload.occurrence).toBe(dayKey(TODAY));
    expect(payload.repeat).toMatchObject({ unit: "day", interval: 1 });
  });

  it("asks which one when deleting an occurrence, and can drop just the day", async () => {
    range.mockResolvedValue({ events: [OCCURRENCE], note_dates: [] });
    render(<CalendarView onOpenNote={() => {}} onError={() => {}} />);

    fireEvent.click(await screen.findByTitle("Standup"));
    fireEvent.click(await screen.findByText("Delete"));

    // The dialog closes into the question rather than deleting outright.
    expect(deleteEvent).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByText(/^This day/));

    await waitFor(() => expect(deleteEventOccurrence).toHaveBeenCalledWith("series-1", dayKey(TODAY)));
    expect(deleteEvent).not.toHaveBeenCalled();
  });

  it("deletes the whole series when that's the answer", async () => {
    range.mockResolvedValue({ events: [OCCURRENCE], note_dates: [] });
    render(<CalendarView onOpenNote={() => {}} onError={() => {}} />);

    fireEvent.click(await screen.findByTitle("Standup"));
    fireEvent.click(await screen.findByText("Delete"));
    fireEvent.click(await screen.findByText("Whole series"));

    await waitFor(() => expect(deleteEvent).toHaveBeenCalledWith("series-1"));
    expect(deleteEventOccurrence).not.toHaveBeenCalled();
  });

  it("deletes a one-off event without asking", async () => {
    const plain: CalEvent = { ...OCCURRENCE, id: "e1", repeat: null, occurrence: null };
    range.mockResolvedValue({ events: [plain], note_dates: [] });
    render(<CalendarView onOpenNote={() => {}} onError={() => {}} />);

    fireEvent.click(await screen.findByTitle("Standup"));
    fireEvent.click(await screen.findByText("Delete"));

    await waitFor(() => expect(deleteEvent).toHaveBeenCalledWith("e1"));
    expect(screen.queryByText("Whole series")).toBeNull();
  });
});
