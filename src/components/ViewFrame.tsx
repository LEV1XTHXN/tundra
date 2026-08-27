/**
 * The shared shell every top-level view (Home, Graph, Calendar, Kanban, Quick
 * notes) renders into. It contributes the view's identity — breadcrumb, title
 * and actions — to the shell's single top bar, and gives the body uniform
 * padding and scrolling. Presentation only: each view still owns its own
 * data/behavior, this just saves it from wiring the top bar itself.
 *
 * The header used to be a tall block *inside* this component. It now lives in
 * `app/TopBar.tsx`, one row across the whole window, and `ViewFrame` reaches it
 * through the `TopBar` portal — so a view's call site is unchanged.
 *
 * The Notes/editor view is the one exception: its title is an inline-editable
 * field in the document itself, so it keeps its own markup and renders `TopBar`
 * directly. It still shares the same `--view-padding-x` horizontal padding (see
 * index.css) so its content lines up with every other view.
 */
import type { ReactNode } from "react";
import { TopBar } from "@/app/TopBar";

interface ViewFrameProps {
  /** Ancestors shown before the title in the top bar, dimmed and `/`-separated
   * (Kanban's `["Boards"]`, Calendar's `["Calendar"]`). */
  crumbs?: readonly string[];
  title: ReactNode;
  /** A dimmed suffix after the title — counts and the like. */
  subtitle?: ReactNode;
  /** Right-aligned controls in the top bar (e.g. Calendar's month nav, Graph's
   * info-panel toggle). */
  actions?: ReactNode;
  /** Controls that read as a group of their own, placed before `actions`
   * (e.g. Kanban's board tabs). */
  toolbar?: ReactNode;
  /** Skip the body's padding/scroll for views that manage their own full-bleed
   * layout and scrolling (Graph's canvas, Kanban's columns). */
  fullBleed?: boolean;
  children: ReactNode;
}

export function ViewFrame({
  crumbs,
  title,
  subtitle,
  actions,
  toolbar,
  fullBleed,
  children,
}: ViewFrameProps) {
  return (
    <div className="view-frame">
      <TopBar
        crumbs={crumbs}
        title={title}
        subtitle={subtitle}
        actions={
          toolbar || actions ? (
            <>
              {toolbar}
              {actions}
            </>
          ) : undefined
        }
      />
      <div className={`view-frame-body${fullBleed ? " full-bleed" : ""}`}>{children}</div>
    </div>
  );
}
