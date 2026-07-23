/**
 * The shell's left-edge icon ribbon — the app's top-level navigation. A thin
 * icon-only strip that slides open to icons + labels (persisted in the appearance
 * app-settings blob, so it survives a restart).
 *
 * Two kinds of entry live here: *views*, which swap the main pane via
 * `useViewState`, and *actions*, which open an overlay the shell already owns
 * (the search palette, the settings dialog). Settings is pinned to the bottom.
 * Replaces the old stacked text view-switcher + sidebar action buttons.
 */
import {
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  Home as HomeIcon,
  Kanban as KanbanIcon,
  LayoutTemplate,
  Network,
  NotebookPen,
  Search,
  Settings,
  Tags as TagsIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/store/theme";
import { useViewState, type AppView } from "@/store/viewState";

type RibbonItem =
  | { kind: "view"; id: AppView; label: string; icon: LucideIcon }
  | { kind: "action"; id: "search" | "settings"; label: string; icon: LucideIcon };

/** Ribbon entries in display order. `Settings` is rendered separately, pinned to
 *  the bottom of the strip. */
const ITEMS: RibbonItem[] = [
  { kind: "view", id: "home", label: "Home", icon: HomeIcon },
  { kind: "action", id: "search", label: "Search", icon: Search },
  { kind: "view", id: "editor", label: "Notes", icon: FileText },
  { kind: "view", id: "graph", label: "Graph", icon: Network },
  { kind: "view", id: "calendar", label: "Calendar", icon: CalendarDays },
  { kind: "view", id: "kanban", label: "Kanban", icon: KanbanIcon },
  { kind: "view", id: "quicknotes", label: "Quick notes", icon: NotebookPen },
  { kind: "view", id: "tags", label: "Tags", icon: TagsIcon },
  { kind: "view", id: "templates", label: "Templates", icon: LayoutTemplate },
];

const SETTINGS_ITEM: RibbonItem = {
  kind: "action",
  id: "settings",
  label: "Settings",
  icon: Settings,
};

interface RibbonProps {
  onSearch: () => void;
  onSettings: () => void;
}

export function Ribbon({ onSearch, onSettings }: RibbonProps) {
  const view = useViewState((s) => s.view);
  const setView = useViewState((s) => s.setView);
  const expanded = useTheme((s) => s.ribbonExpanded);
  const setExpanded = useTheme((s) => s.setRibbonExpanded);

  /** A view entry is active for its own view, plus the sub-views that belong to
   *  it: a folder table is part of Notes, an open template part of Templates. */
  const isActive = (item: RibbonItem): boolean => {
    if (item.kind !== "view") return false;
    if (item.id === "editor") return view === "editor" || view === "folder";
    if (item.id === "templates") return view === "templates" || view === "template";
    return view === item.id;
  };

  const renderItem = (item: RibbonItem) => {
    const active = isActive(item);
    return (
      <button
        key={`${item.kind}:${item.id}`}
        className={cn("ribbon-item", active && "active")}
        role={item.kind === "view" ? "tab" : undefined}
        aria-selected={item.kind === "view" ? active : undefined}
        // Collapsed, the icon is the only affordance — keep the name reachable.
        title={expanded ? undefined : item.label}
        aria-label={item.label}
        onClick={() => {
          if (item.kind === "view") setView(item.id);
          else if (item.id === "search") onSearch();
          else onSettings();
        }}
      >
        <item.icon className="ribbon-item-icon h-[18px] w-[18px]" />
        {expanded && <span className="ribbon-item-label">{item.label}</span>}
      </button>
    );
  };

  return (
    <nav
      className={cn("ribbon", expanded && "expanded")}
      role="tablist"
      aria-label="Sections"
      aria-orientation="vertical"
    >
      <div className="ribbon-items">{ITEMS.map(renderItem)}</div>
      <div className="ribbon-bottom">
        {renderItem(SETTINGS_ITEM)}
        <button
          className="ribbon-item ribbon-toggle"
          title={expanded ? "Collapse sidebar" : "Expand sidebar"}
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronsLeft className="ribbon-item-icon h-[18px] w-[18px]" />
          ) : (
            <ChevronsRight className="ribbon-item-icon h-[18px] w-[18px]" />
          )}
          {expanded && <span className="ribbon-item-label">Collapse</span>}
        </button>
      </div>
    </nav>
  );
}
