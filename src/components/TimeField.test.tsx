// @vitest-environment jsdom
/**
 * The time field, in its two halves.
 *
 * `parseTimeInput` is the reason this component exists instead of a pair of
 * dropdowns, so most of the file is its table: what people actually type has to
 * come out as the time they meant, and anything that isn't a time has to be
 * refused rather than guessed at (the field reverts, so a wrong guess would be
 * silent data loss).
 *
 * The rest pins the component's contract: typing commits on blur, the quarter-
 * hour list picks a time, and "All day" (`disabled`) shuts both paths off.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { useTheme } from "@/store/theme";
import { parseTimeInput, TimeField } from "./TimeField";

/** 09:00 — the value every fixture starts from. */
const NINE = 9 * 60;
const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

describe("parseTimeInput", () => {
  const parse = (raw: string, current = NINE) => parseTimeInput(raw, current, "24h");

  it("reads a bare hour", () => {
    expect(parse("9")).toBe(9 * 60);
    expect(parse("09")).toBe(9 * 60);
    expect(parse("0")).toBe(0);
    expect(parse("23")).toBe(23 * 60);
  });

  it("splits a bare run of digits at the last two", () => {
    expect(parse("930")).toBe(9 * 60 + 30);
    expect(parse("0930")).toBe(9 * 60 + 30);
    expect(parse("2350")).toBe(23 * 60 + 50);
    expect(parse("1430")).toBe(14 * 60 + 30);
  });

  it("accepts the separators people actually type", () => {
    for (const raw of ["9:30", "9.30", "9 30", " 9:30 "]) expect(parse(raw)).toBe(9 * 60 + 30);
    expect(parse("9:05")).toBe(9 * 60 + 5);
  });

  it("honours an explicit am/pm in 24-hour mode too", () => {
    expect(parse("230pm")).toBe(14 * 60 + 30);
    expect(parse("2:30 PM")).toBe(14 * 60 + 30);
    expect(parse("12am")).toBe(0);
    expect(parse("12pm")).toBe(12 * 60);
    expect(parse("9a")).toBe(9 * 60);
  });

  it("refuses anything that isn't a time", () => {
    for (const raw of ["", "  ", "abc", "9x", "2560", "24:00", "2:75", "19pm", "930:15", "12345"]) {
      expect(parse(raw), raw).toBeNull();
    }
  });

  it("keeps the shown half of the day for a bare hour in 12-hour mode", () => {
    const afternoon = 14 * 60; // the field currently reads 2:00 PM
    expect(parseTimeInput("9", afternoon, "12h")).toBe(21 * 60);
    expect(parseTimeInput("9", NINE, "12h")).toBe(9 * 60);
    // An explicit suffix still wins, and a 24-hour number is taken at face value.
    expect(parseTimeInput("9am", afternoon, "12h")).toBe(9 * 60);
    expect(parseTimeInput("1930", afternoon, "12h")).toBe(19 * 60 + 30);
  });
});

describe("TimeField", () => {
  beforeAll(() => {
    useTheme.setState({ timeFormat: "24h" });
    Element.prototype.scrollIntoView = () => {};
  });
  afterEach(cleanup);

  function renderField(props: Partial<React.ComponentProps<typeof TimeField>> = {}) {
    const onChange = vi.fn();
    render(<TimeField value={NINE} onChange={onChange} aria-label="Start time" {...props} />);
    return { onChange, input: screen.getByLabelText("Start time") as HTMLInputElement };
  }

  it("shows the value as a wall-clock time", () => {
    expect(renderField().input.value).toBe("09:00");
  });

  it("commits typed text on blur", () => {
    const { onChange, input } = renderField();
    fireEvent.change(input, { target: { value: "2350" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(23 * 60 + 50);
  });

  it("commits on Enter", () => {
    const { onChange, input } = renderField();
    fireEvent.change(input, { target: { value: "930" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(9 * 60 + 30);
  });

  it("reverts unparseable text instead of clearing the field", () => {
    const { onChange, input } = renderField();
    fireEvent.change(input, { target: { value: "nope" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("09:00");
  });

  it("opens a list of quarter-hour marks and picks one", () => {
    const { onChange, input } = renderField();
    fireEvent.click(input);

    const marks = document.querySelectorAll(".time-field-mark");
    expect(marks.length).toBe(96);
    expect(marks[0].textContent).toBe("00:00");
    expect(marks[1].textContent).toBe("00:15");

    fireEvent.click(screen.getByText("10:30"));
    expect(onChange).toHaveBeenCalledWith(10 * 60 + 30);
  });

  it("marks the current value active", () => {
    const { input } = renderField({ value: 10 * 60 + 15 });
    fireEvent.click(input);
    const active = document.querySelectorAll(".time-field-mark.active");
    expect(active.length).toBe(1);
    expect(active[0].textContent).toBe(hhmm(10 * 60 + 15));
  });

  it("is inert when disabled — no list, no commit", () => {
    const { onChange, input } = renderField({ disabled: true });
    expect(input.disabled).toBe(true);
    fireEvent.click(input);
    expect(document.querySelectorAll(".time-field-mark").length).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
  });
});
