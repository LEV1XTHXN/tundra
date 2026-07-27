/**
 * A wall-clock time input: type it, or pick it off a list of quarter-hour marks.
 *
 * Native `<input type="time">` is out for the same reason `DateTimePicker` avoids
 * `type="date"` — it renders as a different, unstylable OS widget on every
 * platform. Dropdowns are out too: choosing 14:30 from a 24-row hour list and a
 * 60-row minute list is four interactions for something a keyboard does in four
 * keystrokes.
 *
 * So: a plain text field that accepts how people actually write times (`930`,
 * `9:30`, `2350`, `2.30pm`) and, on click, a popover of every 15-minute mark of
 * the day for the times you'd rather point at than type. The value is minutes
 * past midnight — no date, no timezone; whoever owns the day combines the two.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { format, type Locale } from "date-fns";

import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useTheme } from "@/store/theme";
import type { TimeFormatPref } from "@/store/theme";
import { clockPattern, useDateLocale } from "@/i18n/dateLocale";

/** Minutes in a day — the exclusive upper bound of a valid value. */
const DAY_MINUTES = 24 * 60;
/** The grain of the pick-list. Matches the calendar grid's own `SNAP_MINUTES`:
 *  a time you can drag out in the week view is a time you can pick here. */
const MARK_MINUTES = 15;

/** Every quarter-hour of the day, as minutes past midnight. */
const MARKS = Array.from({ length: DAY_MINUTES / MARK_MINUTES }, (_, i) => i * MARK_MINUTES);

/**
 * `minutes` past midnight as a wall-clock label, in the user's clock format.
 * Anchored to an arbitrary fixed date — only the time half is ever shown.
 */
export function formatMinutes(minutes: number, timeFormat: TimeFormatPref, locale?: Locale): string {
  const at = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
  return format(at, clockPattern(timeFormat), { locale });
}

/**
 * Read a typed time. Returns minutes past midnight, or `null` if the text isn't
 * a time at all — callers revert to the previous value rather than guessing.
 *
 * Accepted, deliberately loosely: `9` → 09:00, `930`/`9:30`/`9.30`/`9 30` →
 * 09:30, `0930` → 09:30, `2350` → 23:50, `2:30pm` → 14:30. A bare run of digits
 * splits at the last two (so `930` is half past nine, not "nine hundred thirty").
 *
 * `current` only matters in 12-hour mode, where a bare `9` is genuinely
 * ambiguous: it keeps whichever half of the day the field is already showing,
 * which is what makes nudging 9:00 → 9:30 work without retyping "am".
 */
export function parseTimeInput(
  raw: string,
  current: number,
  timeFormat: TimeFormatPref,
): number | null {
  const text = raw.trim().toLowerCase();
  const match = /^(\d{1,4})(?:\s*[:.\s]\s*(\d{1,2}))?\s*(am|pm|a|p)?$/.exec(text);
  if (!match) return null;
  const [, lead, tail, meridiem] = match;

  let hours: number;
  let minutes: number;
  if (tail !== undefined) {
    if (lead.length > 2) return null; // "930:15" is not a time
    hours = Number(lead);
    minutes = Number(tail);
  } else if (lead.length <= 2) {
    hours = Number(lead);
    minutes = 0;
  } else {
    hours = Number(lead.slice(0, -2));
    minutes = Number(lead.slice(-2));
  }

  if (meridiem) {
    // An explicit am/pm is honoured in either clock mode, but only over a
    // 12-hour number — "19pm" is a typo, not a time.
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem.startsWith("p") ? 12 : 0);
  } else if (timeFormat === "12h" && hours >= 1 && hours <= 11) {
    hours += current >= DAY_MINUTES / 2 ? 12 : 0;
  }

  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

interface TimeFieldProps {
  /** Minutes past midnight, 0–1439. */
  value: number;
  onChange: (minutes: number) => void;
  /** Greys the field and stops the mark list opening — what "All day" does. */
  disabled?: boolean;
  "aria-label"?: string;
}

export function TimeField({ value, onChange, disabled, "aria-label": label }: TimeFieldProps) {
  const timeFormat = useTheme((s) => s.timeFormat);
  const dateLocale = useDateLocale();
  const shown = formatMinutes(value, timeFormat, dateLocale);

  // The field is uncontrolled WHILE being typed in: half-finished text ("23")
  // isn't a time yet, so it can't be round-tripped through `value`. It resyncs
  // to the formatted value on every commit and on any outside change.
  const [text, setText] = useState(shown);
  const [open, setOpen] = useState(false);
  const activeMark = useRef<HTMLButtonElement | null>(null);
  useEffect(() => setText(shown), [shown]);

  const commit = () => {
    const parsed = parseTimeInput(text, value, timeFormat);
    // Unparseable input reverts rather than clearing: the field always holds a
    // real time, so the dialog around it never has to handle a null one.
    if (parsed === null || parsed === value) setText(shown);
    else onChange(parsed);
  };

  // Bring the current time into view as the list opens — 96 marks is a long
  // scroll to 14:30 otherwise.
  useEffect(() => {
    if (open) activeMark.current?.scrollIntoView({ block: "center" });
  }, [open]);

  const nearestMark = useMemo(() => Math.round(value / MARK_MINUTES) * MARK_MINUTES, [value]);

  return (
    <Popover open={open} onOpenChange={(next) => setOpen(next && !disabled)}>
      <PopoverAnchor asChild>
        <Input
          className="time-field"
          value={text}
          disabled={disabled}
          aria-label={label}
          inputMode="numeric"
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
          onClick={() => setOpen(true)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
              setOpen(false);
            } else if (e.key === "Escape") {
              setText(shown);
              setOpen(false);
            }
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        className="time-field-menu"
        align="start"
        // Focus stays in the input while the list is open, so typing and picking
        // are the same gesture rather than two modes.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {MARKS.map((mark) => (
          <button
            key={mark}
            type="button"
            ref={mark === nearestMark ? activeMark : undefined}
            className={`time-field-mark${mark === value ? " active" : ""}`}
            onClick={() => {
              onChange(mark);
              setOpen(false);
            }}
          >
            {formatMinutes(mark, timeFormat, dateLocale)}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
