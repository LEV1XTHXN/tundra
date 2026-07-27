/**
 * Right-click menus for the calendar grid. Same split as the nav tree's menus
 * (`src/nav/NavContextMenu.tsx`): these components are purely presentational and
 * dispatch through a `CalendarMenuActions` object, while `CalendarView` keeps
 * the dialog state and does the mutations.
 *
 * The menu is target-aware: right-clicking a day (month cell, week hour column,
 * week day header) creates *on* that day, right-clicking an event acts on that
 * event. In week mode `hour` carries where in the day the click landed, so a new
 * event pre-fills a timed block instead of an all-day one.
 */
import type { ReactElement } from "react";
import { Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { Event as CalEvent } from "@/services";

/** What a calendar menu can dispatch — supplied by `CalendarView`, which owns
 *  the event/link dialogs and the delete mutation. */
export interface CalendarMenuActions {
  /** `hour` unset = all-day, matching the day-cell and toolbar create paths. */
  onNewEvent: (day: Date, hour?: number) => void;
  onLinkNote: (day: Date) => void;
  onEditEvent: (day: Date, event: CalEvent) => void;
  onDeleteEvent: (event: CalEvent) => void;
}

/** Menu for a day's empty space — a month cell, a week hour column, or a week
 *  day header. */
export function CalendarDayMenu({
  day,
  hour,
  actions,
}: {
  day: Date;
  hour?: number;
  actions: CalendarMenuActions;
}) {
  const { t } = useTranslation();
  return (
    <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
      <ContextMenuItem onSelect={() => actions.onNewEvent(day, hour)}>
        <Plus /> {t("calendar.newEvent")}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => actions.onLinkNote(day)}>
        <Link2 /> {t("calendar.linkNote")}
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/** Menu for a single event — a month bar/row, or a week chip/block. Delete is
 *  immediate (no confirmation), like the event dialog's own Delete button. */
export function CalendarEventMenu({
  day,
  event,
  actions,
}: {
  day: Date;
  event: CalEvent;
  actions: CalendarMenuActions;
}) {
  const { t } = useTranslation();
  return (
    <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
      <ContextMenuItem onSelect={() => actions.onEditEvent(day, event)}>
        <Pencil /> {t("calendar.editEvent")}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => actions.onDeleteEvent(event)}>
        <Trash2 /> {t("calendar.deleteEvent")}
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/**
 * Attaches the event menu to one rendered event — a month bar/row, a week chip
 * or block. Every one of them sits inside a day that has its own menu, so the
 * right-click is stopped here: Radix composes our handler ahead of its own, and
 * `stopPropagation` (not `preventDefault`) keeps the trigger working while the
 * day menu behind it never sees the event.
 */
export function EventContextMenu({
  day,
  event,
  actions,
  children,
}: {
  day: Date;
  event: CalEvent;
  actions: CalendarMenuActions;
  children: ReactElement;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={(e) => e.stopPropagation()}>
        {children}
      </ContextMenuTrigger>
      <CalendarEventMenu day={day} event={event} actions={actions} />
    </ContextMenu>
  );
}
