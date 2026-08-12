/**
 * The shell sidebar's contents while the Calendar view is open: a mini month
 * that drives the main grid, in place of the note tree. Both read the same
 * `calendarCursor` from `useViewState`, so navigating either one moves the
 * other (UI state only — no data logic here).
 *
 * Clicking a DAY additionally drills into it — the main grid switches to that
 * day's week, the same gesture the month grid's own cells perform. Without the
 * mode switch the click would be invisible: the month grid draws the cursor's
 * month, and every day in it yields the same month.
 */
import { useCallback } from "react";

import { useViewState } from "@/store/viewState";
import { MiniMonth } from "./MiniMonth";

export function CalendarSidebar() {
  const cursor = useViewState((s) => s.calendarCursor);
  const setCursor = useViewState((s) => s.setCalendarCursor);
  const setMode = useViewState((s) => s.setCalendarMode);

  const openDayInWeek = useCallback(
    (day: Date) => {
      setCursor(day);
      setMode("week");
    },
    [setCursor, setMode],
  );

  return (
    <div className="calendar-sidebar">
      <MiniMonth
        fitHeight={false}
        cursor={cursor}
        selected={cursor}
        // The ‹ › arrows only page the month — paging is not picking a day, so
        // they deliberately leave the mode alone.
        onCursorChange={setCursor}
        onSelectDay={openDayInWeek}
      />
      {/* "Today" moves the cursor without drilling in: it means "go to now" in
          whichever grid is up, not "switch me to this week". */}
      <button className="calendar-sidebar-today" onClick={() => setCursor(new Date())}>
        Today
      </button>
    </div>
  );
}
