/**
 * The shell's single top bar — one 44px row spanning every column, replacing
 * the tall per-view headers each surface used to paint for itself.
 *
 * It has three parts:
 *
 *   - a fixed **lead** segment, as wide as the ribbon column, holding the two
 *     controls that belong to the shell rather than to any view: the sidebar
 *     toggle and the back/forward history buttons;
 *   - a **slot** the active view fills, via the {@link TopBar} portal below;
 *   - a **trail** for shell-owned chrome that has to sit after the view's own
 *     actions — currently just the note inspector's toggle.
 *
 * The slot is a portal rather than props threaded down through `MainPane` so a
 * view keeps declaring its own title and actions where it always did (see
 * `ViewFrame`), and nothing in between has to know about them. Exactly one view
 * is mounted at a time, so exactly one component ever fills the slot.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PanelLeftClose, PanelLeftOpen, PanelRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { useTheme } from "@/store/theme";
import { useViewState } from "@/store/viewState";
import { NavHistoryButtons } from "./NavHistoryButtons";

/** The live slot element, or `null` before the bar has mounted. */
const TopBarSlotContext = createContext<HTMLElement | null>(null);

/**
 * Renders the bar and publishes its slot to the tree below. Wraps the rest of
 * the shell because the context has to reach every view; the provider itself
 * emits no DOM, so the bar and `children` stay direct grid children of `.app`.
 */
export function TopBarHost({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  return (
    <TopBarSlotContext.Provider value={slot}>
      <header className="topbar">
        <div className="topbar-lead">
          <SidebarToggle />
          <NavHistoryButtons />
        </div>
        <div className="topbar-slot" ref={setSlot} />
        <InspectorToggle />
      </header>
      {children}
    </TopBarSlotContext.Provider>
  );
}

interface TopBarProps {
  /** Ancestors shown before the title, dimmed and `/`-separated. */
  crumbs?: readonly string[];
  title: ReactNode;
  /** A dimmed suffix after the title — counts and the like. The bar is one row,
   *  so there is nowhere to stack a second line. */
  subtitle?: ReactNode;
  /** Right-aligned controls for this view. */
  actions?: ReactNode;
}

/**
 * Puts one view's breadcrumb + actions into the bar.
 *
 * With no host above it — a view rendered on its own, which is how the tests
 * mount them — it renders the same content in place instead. Losing a view's
 * title and every one of its actions is a worse failure than showing them in
 * the wrong spot.
 */
export function TopBar({ crumbs, title, subtitle, actions }: TopBarProps) {
  const slot = useContext(TopBarSlotContext);

  const content = (
    <>
      <div className="topbar-titles">
        {crumbs?.map((crumb) => (
          <span key={crumb} className="topbar-crumb">
            <span className="topbar-crumb-label">{crumb}</span>
            <span className="topbar-crumb-sep" aria-hidden="true">
              /
            </span>
          </span>
        ))}
        <h1 className="topbar-title">{title}</h1>
        {subtitle && <span className="topbar-subtitle">{subtitle}</span>}
      </div>
      {actions && <div className="topbar-actions">{actions}</div>}
    </>
  );

  return slot ? createPortal(content, slot) : <div className="topbar-detached">{content}</div>;
}

/**
 * Shows/hides the shell's second column — the note tree, or whatever the open
 * view puts in its place. One flag for the whole app, persisted
 * (`store/theme.ts`): it says how much chrome you want on screen, and that
 * answer doesn't change just because you looked at the graph.
 */
function SidebarToggle() {
  const { t } = useTranslation();
  const hidden = useTheme((s) => s.sidebarHidden);
  const toggleSidebar = useTheme((s) => s.toggleSidebar);
  const label = hidden ? t("topbar.showSidebar") : t("topbar.hideSidebar");

  return (
    <button
      className={cn("topbar-button", !hidden && "active")}
      onClick={toggleSidebar}
      title={label}
      aria-label={label}
      aria-pressed={!hidden}
    >
      {hidden ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
    </button>
  );
}

/**
 * The note inspector's toggle. Shell chrome rather than one of the editor's own
 * actions: `inspectorOpen` is view state the shell owns, and the drawer it
 * opens is a column of the main pane, not part of the document.
 */
function InspectorToggle() {
  const { t } = useTranslation();
  const view = useViewState((s) => s.view);
  const openNoteId = useViewState((s) => s.openNoteId);
  const inspectorOpen = useViewState((s) => s.inspectorOpen);
  const toggleInspector = useViewState((s) => s.toggleInspector);

  if (view !== "editor" || !openNoteId) return null;
  const label = inspectorOpen ? t("topbar.hideInspector") : t("topbar.showInspector");

  return (
    <button
      className={cn("topbar-button", "topbar-trail", inspectorOpen && "active")}
      onClick={toggleInspector}
      title={label}
      aria-label={label}
      aria-pressed={inspectorOpen}
    >
      <PanelRight className="h-4 w-4" />
    </button>
  );
}
