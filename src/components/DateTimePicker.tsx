/**
 * Shared, platform-agnostic date/time picker. Native `<input type="date">`/
 * `<input type="time">` render as completely different OS/browser-native
 * widgets across Windows/macOS/Linux (and can't be restyled), which breaks
 * visual consistency for a cross-platform app — see CLAUDE.md's WebKitGTK
 * note. This renders entirely in-app (a button trigger + Popover containing
 * shadcn's Calendar and Select-based hour/minute pickers), so it looks and
 * behaves identically everywhere.
 */
import { useMemo } from "react";
import { format, set } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTheme } from "@/store/theme";

const MINUTES = Array.from({ length: 60 }, (_, i) => i);

interface DateTimePickerProps {
  /** The selected instant, as a local `Date` (never a raw UTC string — the
   * caller owns any ISO conversion at the save boundary). */
  value: Date;
  onChange: (value: Date) => void;
  /** Show the hour/minute selectors. Off for all-day events, where only the
   * calendar day matters. */
  showTime?: boolean;
  disabled?: boolean;
}

export function DateTimePicker({ value, onChange, showTime = true, disabled }: DateTimePickerProps) {
  const timeFormat = useTheme((s) => s.timeFormat);

  const label = useMemo(() => {
    const datePart = format(value, "MMM d, yyyy");
    if (!showTime) return datePart;
    return `${datePart}, ${format(value, timeFormat === "24h" ? "HH:mm" : "h:mm a")}`;
  }, [value, showTime, timeFormat]);

  const hourOptions = useMemo(() => {
    if (timeFormat === "24h") return Array.from({ length: 24 }, (_, i) => i);
    return Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
  }, [timeFormat]);

  const hour24 = value.getHours();
  const isPM = hour24 >= 12;
  const hourDisplay = timeFormat === "24h" ? hour24 : ((hour24 + 11) % 12) + 1;

  function setHour(next: number) {
    let next24 = next;
    if (timeFormat === "12h") {
      next24 = (next % 12) + (isPM ? 12 : 0);
    }
    onChange(set(value, { hours: next24 }));
  }

  function setMinute(next: number) {
    onChange(set(value, { minutes: next }));
  }

  function setAmPm(pm: boolean) {
    const base = hour24 % 12;
    onChange(set(value, { hours: pm ? base + 12 : base }));
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="date-time-picker-trigger justify-start font-normal"
        >
          <CalendarIcon className="h-4 w-4" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="date-time-picker-content" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(day) => {
            if (!day) return;
            onChange(set(value, { year: day.getFullYear(), month: day.getMonth(), date: day.getDate() }));
          }}
        />
        {showTime && (
          <div className="date-time-picker-time">
            <Select value={String(hourDisplay)} onValueChange={(v) => setHour(Number(v))}>
              <SelectTrigger className="date-time-picker-select" aria-label="Hour">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {hourOptions.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {h.toString().padStart(2, "0")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="date-time-picker-colon">:</span>
            <Select value={String(value.getMinutes())} onValueChange={(v) => setMinute(Number(v))}>
              <SelectTrigger className="date-time-picker-select" aria-label="Minute">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MINUTES.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m.toString().padStart(2, "0")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {timeFormat === "12h" && (
              <Select value={isPM ? "PM" : "AM"} onValueChange={(v) => setAmPm(v === "PM")}>
                <SelectTrigger className="date-time-picker-select" aria-label="AM/PM">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AM">AM</SelectItem>
                  <SelectItem value="PM">PM</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
