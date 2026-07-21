import {
  CalendarDays,
  FileText,
  Home as HomeIcon,
  Kanban as KanbanIcon,
  Network,
  NotebookPen,
  type LucideIcon,
} from "lucide-react";
import { useViewState, type AppView } from "@/store/viewState";

/** The top-level views reachable from the shell switcher, in display order. */
const VIEWS: { id: AppView; label: string; icon: LucideIcon }[] = [
  { id: "home", label: "Home", icon: HomeIcon },
  { id: "editor", label: "Notes", icon: FileText },
  { id: "graph", label: "Graph", icon: Network },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "kanban", label: "Kanban", icon: KanbanIcon },
  { id: "quicknotes", label: "Quick", icon: NotebookPen },
];

/** The sidebar's top-level view switcher (tablist). Reads/sets the active view
 *  straight from `useViewState`. */
export function ViewSwitcher() {
  const view = useViewState((s) => s.view);
  const setView = useViewState((s) => s.setView);
  return (
    <nav className="view-switcher" role="tablist" aria-label="Views">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          role="tab"
          aria-selected={view === v.id}
          className={`view-switcher-tab${view === v.id ? " active" : ""}`}
          onClick={() => setView(v.id)}
        >
          <v.icon className="h-4 w-4" />
          {v.label}
        </button>
      ))}
    </nav>
  );
}
