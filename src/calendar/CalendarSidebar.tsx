/**
 * The shell sidebar's contents while the Calendar view is open: a mini month
 * that drives the main grid, in place of the note tree. Both read the same
 * `calendarCursor` from `useViewState`, so navigating either one moves the
 * other (UI state only — no data logic here).
 */
import { useViewState } from "@/store/viewState";
import { MiniMonth } from "./MiniMonth";

export function CalendarSidebar() {
  const cursor = useViewState((s) => s.calendarCursor);
  const setCursor = useViewState((s) => s.setCalendarCursor);

  return (
    <div className="calendar-sidebar">
      <MiniMonth
        fitHeight={false}
        cursor={cursor}
        selected={cursor}
        onCursorChange={setCursor}
        onSelectDay={setCursor}
      />
      <button className="calendar-sidebar-today" onClick={() => setCursor(new Date())}>
        Today
      </button>
    </div>
  );
}
