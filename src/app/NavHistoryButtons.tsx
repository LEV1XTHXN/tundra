import { ChevronLeft, ChevronRight } from "lucide-react";
import { useViewState } from "@/store/viewState";

interface NavHistoryButtonsProps {
  /** Pin to the pane's top-left corner as a floating overlay (the editor view,
   *  which has no ViewFrame header). Default = inline, for placement inside a
   *  ViewFrame header row. */
  floating?: boolean;
}

/**
 * Browser-style back/forward buttons that retrace the navigation history (notes
 * AND viewports — graph, quick notes, calendar, …). Self-contained: reads the
 * history cursor straight from `useViewState` and calls `goBack`/`goForward`, so
 * it can be dropped into any surface (the editor overlay, every ViewFrame header)
 * without prop plumbing. Each arrow disables at its end of the stack.
 */
export function NavHistoryButtons({ floating = false }: NavHistoryButtonsProps) {
  const navIndex = useViewState((s) => s.navIndex);
  const historyLength = useViewState((s) => s.navHistory.length);
  const goBack = useViewState((s) => s.goBack);
  const goForward = useViewState((s) => s.goForward);

  const canGoBack = navIndex > 0;
  const canGoForward = navIndex < historyLength - 1;

  return (
    <div
      className={`nav-history${floating ? " nav-history-floating" : ""}`}
      role="group"
      aria-label="Navigation history"
    >
      <button
        className="nav-history-button"
        onClick={goBack}
        disabled={!canGoBack}
        title="Back"
        aria-label="Go back"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        className="nav-history-button"
        onClick={goForward}
        disabled={!canGoForward}
        title="Forward"
        aria-label="Go forward"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
