/**
 * The shared shell every top-level view (Home, Graph, Calendar, Kanban, Quick
 * notes) renders into — a consistent title + actions header, and a body with
 * uniform padding/scroll. Presentation only: each view still owns its own
 * data/behavior, this just gives them one consistent frame instead of each
 * inventing its own header layout and padding.
 *
 * The Notes/editor view is the one exception — its header is an inline-editable
 * title (icon + input + pin), fundamentally different from a static page title,
 * so it keeps its own header markup (`.editor-header`) rather than this
 * component. It still shares the same `--view-padding-x` horizontal padding
 * (see index.css) so its content lines up with every other view.
 */
import type { ReactNode } from "react";
import { NavHistoryButtons } from "@/app/NavHistoryButtons";

interface ViewFrameProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned controls in the main title row (e.g. Calendar's month nav,
   * Graph's info-panel toggle). */
  actions?: ReactNode;
  /** A second row under the title, for controls that need their own line
   * (e.g. Kanban's board tabs). */
  toolbar?: ReactNode;
  /** Skip the body's padding/scroll for views that manage their own full-bleed
   * layout and scrolling (Graph's canvas, Kanban's columns). */
  fullBleed?: boolean;
  children: ReactNode;
}

export function ViewFrame({ title, subtitle, actions, toolbar, fullBleed, children }: ViewFrameProps) {
  return (
    <div className="view-frame">
      <header className="view-frame-header">
        <div className="view-frame-header-row">
          {/* Browser-style back/forward, top-left of every framed view. */}
          <NavHistoryButtons />
          <div className="view-frame-titles">
            <h1 className="view-frame-title">{title}</h1>
            {subtitle && <p className="view-frame-subtitle muted">{subtitle}</p>}
          </div>
          {actions && <div className="view-frame-actions">{actions}</div>}
        </div>
        {toolbar && <div className="view-frame-toolbar">{toolbar}</div>}
      </header>
      <div className={`view-frame-body${fullBleed ? " full-bleed" : ""}`}>{children}</div>
    </div>
  );
}
