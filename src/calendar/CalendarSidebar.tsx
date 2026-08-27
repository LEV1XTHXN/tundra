/**
 * The shell sidebar's contents while the Calendar view is open: a mini month
 * that drives the main grid, in place of the note tree. Both read the same
 * `calendarCursor` from `useViewState`, so navigating either one moves the
 * other (UI state only — no data logic here).
 *
 * Under it: what's coming up (`CalendarNextUp`), and the New event button —
 * which the mockups put here rather than in the top bar, next to the mini month
 * you'd have used to pick the day. The view owns the dialog, so the button asks
 * for it through `requestNewEvent()` rather than reaching into it.
 *
 * Clicking a DAY additionally drills into it — the main grid switches to that
 * day's week, the same gesture the month grid's own cells perform. Without the
 * mode switch the click would be invisible: the month grid draws the cursor's
 * month, and every day in it yields the same month.
 */
import { useCallback } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useViewState } from "@/store/viewState";
import { CalendarNextUp } from "./CalendarNextUp";
import { MiniMonth } from "./MiniMonth";

export function CalendarSidebar() {
  const { t } = useTranslation();
  const cursor = useViewState((s) => s.calendarCursor);
  const setCursor = useViewState((s) => s.setCalendarCursor);
  const setMode = useViewState((s) => s.setCalendarMode);
  const revision = useViewState((s) => s.calendarRevision);
  const requestNewEvent = useViewState((s) => s.requestNewEvent);

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
        {t("calendar.today")}
      </button>
      <CalendarNextUp refreshKey={revision} />
      <button className="calendar-sidebar-new" onClick={requestNewEvent}>
        <Plus className="h-4 w-4" />
        {t("calendar.newEvent")}
      </button>
    </div>
  );
}
