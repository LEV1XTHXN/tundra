/**
 * Home dashboard (Phase 2 step 6) — the landing view. Shows user-configurable
 * widgets (Pinned / Recent / Quick capture) that can be added, removed, and
 * reordered. The layout is vault-scoped UI state persisted to
 * `.vault/config/home.json` THROUGH RUST (`services.config`) — never
 * localStorage. React renders; all data + persistence go through `services`.
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";

import { config } from "@/services";
import { ViewFrame } from "@/components/ViewFrame";
import { CalendarWidget, PinnedWidget, QuickCaptureWidget, RecentWidget, type WidgetProps } from "./widgets";

type WidgetId = "pinned" | "recent" | "quickCapture" | "calendar";

interface HomeConfig {
  widgets: WidgetId[];
}

const HOME_CONFIG_FILE = "home.json";

const WIDGET_META: { id: WidgetId; title: string; render: (p: WidgetProps) => React.ReactElement }[] = [
  { id: "pinned", title: "Pinned", render: (p) => <PinnedWidget {...p} /> },
  { id: "recent", title: "Recent", render: (p) => <RecentWidget {...p} /> },
  { id: "quickCapture", title: "Quick capture", render: (p) => <QuickCaptureWidget {...p} /> },
  { id: "calendar", title: "Calendar", render: (p) => <CalendarWidget {...p} /> },
];

const DEFAULT_WIDGETS: WidgetId[] = ["pinned", "recent", "quickCapture", "calendar"];

/** Keep only known widget ids, de-duplicated; fall back to the default layout
 *  when there's no saved config (vs. an explicitly emptied one). */
function sanitize(ids: WidgetId[] | undefined): WidgetId[] {
  if (!ids) return DEFAULT_WIDGETS;
  const known = new Set(WIDGET_META.map((w) => w.id));
  const seen = new Set<WidgetId>();
  return ids.filter((id) => known.has(id) && !seen.has(id) && (seen.add(id), true));
}

function titleOf(id: WidgetId): string {
  return WIDGET_META.find((w) => w.id === id)?.title ?? id;
}

function renderWidget(id: WidgetId, props: WidgetProps): React.ReactElement | null {
  return WIDGET_META.find((w) => w.id === id)?.render(props) ?? null;
}

export function Home({
  vaultPath,
  refreshKey,
  onOpenNote,
  onError,
}: {
  vaultPath: string;
  refreshKey: unknown;
  onOpenNote: (id: string) => void;
  onError: (message: string) => void;
}) {
  // null = still loading the saved layout.
  const [widgets, setWidgets] = useState<WidgetId[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    config
      .read<HomeConfig>(HOME_CONFIG_FILE)
      .then((cfg) => {
        if (!cancelled) setWidgets(sanitize(cfg?.widgets));
      })
      .catch(() => {
        if (!cancelled) setWidgets(DEFAULT_WIDGETS);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(
    (next: WidgetId[]) => {
      setWidgets(next);
      void config.write(HOME_CONFIG_FILE, { widgets: next } satisfies HomeConfig).catch((e) => onError(String(e)));
    },
    [onError],
  );

  if (widgets === null) {
    return (
      <ViewFrame title="Home">
        <div className="centered muted">Loading…</div>
      </ViewFrame>
    );
  }

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= widgets.length) return;
    const next = [...widgets];
    [next[index], next[target]] = [next[target], next[index]];
    persist(next);
  };
  const remove = (id: WidgetId) => persist(widgets.filter((w) => w !== id));
  const add = (id: WidgetId) => persist([...widgets, id]);
  const available = WIDGET_META.filter((w) => !widgets.includes(w.id));

  const widgetProps: WidgetProps = { vaultPath, refreshKey, onOpenNote, onError };

  const addWidgetActions = available.length > 0 && (
    <div className="home-add">
      <span className="muted">Add widget:</span>
      {available.map((w) => (
        <button key={w.id} className="home-add-btn" onClick={() => add(w.id)}>
          <Plus className="h-3.5 w-3.5" />
          {w.title}
        </button>
      ))}
    </div>
  );

  return (
    <ViewFrame title="Home" actions={addWidgetActions || undefined}>
      {widgets.length === 0 ? (
        <div className="centered muted">No widgets — add one above.</div>
      ) : (
        <div className="home-widgets">
          {widgets.map((id, index) => (
            <section key={id} className="widget">
              <div className="widget-header">
                <h2 className="widget-title">{titleOf(id)}</h2>
                <div className="widget-controls">
                  <button onClick={() => move(index, -1)} disabled={index === 0} title="Move up" aria-label="Move up">
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => move(index, 1)}
                    disabled={index === widgets.length - 1}
                    title="Move down"
                    aria-label="Move down"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => remove(id)} title="Remove widget" aria-label="Remove widget">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="widget-body">{renderWidget(id, widgetProps)}</div>
            </section>
          ))}
        </div>
      )}
    </ViewFrame>
  );
}
