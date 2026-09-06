import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useViewState } from "@/store/viewState";

/**
 * Browser-style back/forward buttons that retrace the navigation history (notes
 * AND viewports — graph, quick notes, calendar, …). Self-contained: reads the
 * history cursor straight from `useViewState` and calls `goBack`/`goForward`, so
 * the top bar can drop it in without prop plumbing. Each arrow disables at its
 * end of the stack.
 */
export function NavHistoryButtons() {
  const { t } = useTranslation();
  const navIndex = useViewState((s) => s.navIndex);
  const historyLength = useViewState((s) => s.navHistory.length);
  const goBack = useViewState((s) => s.goBack);
  const goForward = useViewState((s) => s.goForward);

  const canGoBack = navIndex > 0;
  const canGoForward = navIndex < historyLength - 1;

  return (
    <div className="nav-history" role="group" aria-label="Navigation history">
      <button
        className="topbar-button"
        onClick={goBack}
        disabled={!canGoBack}
        title={t("keybindings.commands.nav_back.label")}
        aria-label={t("keybindings.commands.nav_back.label")}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        className="topbar-button"
        onClick={goForward}
        disabled={!canGoForward}
        title={t("keybindings.commands.nav_forward.label")}
        aria-label={t("keybindings.commands.nav_forward.label")}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
