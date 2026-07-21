/**
 * Home dashboard (Phase 2 step 6) — the landing view. Shows user-configurable
 * widgets (Pinned / Recent / Quick capture / Calendar) that can be added,
 * removed, reordered, and RESIZED on an invisible grid: drag a widget's
 * bottom-right corner to make it span more columns/rows (e.g. 1×1 → 2×2). The
 * layout (order + per-widget sizes) is vault-scoped UI state persisted to
 * `.vault/config/home.json` THROUGH RUST (`services.config`) — never
 * localStorage. React renders; all data + persistence go through `services`.
 */
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";

import { config } from "@/services";
import { ViewFrame } from "@/components/ViewFrame";
import {
  CalendarWidget,
  PinnedWidget,
  QuickCaptureWidget,
  RecentWidget,
  StorageWidget,
  StreakWidget,
  type WidgetProps,
} from "./widgets";

// Split out (like App.tsx's own `GraphView`) so `sigma`/`graphology` — a heavy
// WebGL lib — aren't eagerly bundled into Home's landing-view chunk.
const MiniGraphWidget = lazy(() =>
  import("./MiniGraphWidget").then((m) => ({ default: m.MiniGraphWidget })),
);

type WidgetId = "pinned" | "recent" | "quickCapture" | "calendar" | "storage" | "streak" | "miniGraph";

/** Widget span on the invisible grid, in whole cells. */
interface WidgetSize {
  w: number;
  h: number;
}

interface HomeConfig {
  widgets: WidgetId[];
  /** Per-widget span; absent = 1×1. */
  sizes?: Partial<Record<WidgetId, WidgetSize>>;
}

const HOME_CONFIG_FILE = "home.json";

/** Invisible-grid geometry. A cell is sized to comfortably hold a whole widget
 *  (CELL_MIN wide, ~square tall) — the board fits as many such columns as the
 *  window allows, and every column is an equal `1fr` so widgets scale
 *  proportionally with the window. Drag a widget's corner to span more cells.
 *  GAP must match the CSS grid `gap`. */
const CELL_MIN = 300; // px — minimum width of one cell (drives the column count)
const ROW_RATIO = 1.15; // row height per cell-width unit (tall enough for the calendar)
const ROW_MIN = 240; // px — floor so a 1×1 cell always fits a whole widget
const ROW_MAX = 460; // px — cap so a wide single-column layout can't fill the screen
const GAP = 16; // px — must equal `.home-widgets` gap (1rem)
const MAX_W_SPAN = 6; // cap on how many columns a widget may store
const MAX_H_SPAN = 4; // cap on how many rows a widget can span

const WIDGET_META: { id: WidgetId; title: string; render: (p: WidgetProps) => React.ReactElement }[] = [
  { id: "pinned", title: "Pinned", render: (p) => <PinnedWidget {...p} /> },
  { id: "recent", title: "Recent", render: (p) => <RecentWidget {...p} /> },
  { id: "quickCapture", title: "Quick capture", render: (p) => <QuickCaptureWidget {...p} /> },
  { id: "calendar", title: "Calendar", render: (p) => <CalendarWidget {...p} /> },
  { id: "storage", title: "Storage", render: (p) => <StorageWidget {...p} /> },
  { id: "streak", title: "Streak", render: (p) => <StreakWidget {...p} /> },
  {
    id: "miniGraph",
    title: "Graph",
    render: (p) => (
      <Suspense fallback={<div className="centered muted">Loading…</div>}>
        <MiniGraphWidget {...p} />
      </Suspense>
    ),
  },
];

const DEFAULT_WIDGETS: WidgetId[] = [
  "pinned",
  "recent",
  "quickCapture",
  "calendar",
  "storage",
  "streak",
  "miniGraph",
];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Keep only known widget ids, de-duplicated; fall back to the default layout
 *  when there's no saved config (vs. an explicitly emptied one). */
function sanitize(ids: WidgetId[] | undefined): WidgetId[] {
  if (!ids) return DEFAULT_WIDGETS;
  const known = new Set(WIDGET_META.map((w) => w.id));
  const seen = new Set<WidgetId>();
  return ids.filter((id) => known.has(id) && !seen.has(id) && (seen.add(id), true));
}

/** Coerce a stored/edited size into whole cells within the board's bounds. */
function normSize(s: WidgetSize | undefined): WidgetSize {
  return {
    w: clamp(Math.round(s?.w ?? 1), 1, MAX_W_SPAN),
    h: clamp(Math.round(s?.h ?? 1), 1, MAX_H_SPAN),
  };
}

function titleOf(id: WidgetId): string {
  return WIDGET_META.find((w) => w.id === id)?.title ?? id;
}

function renderWidget(id: WidgetId, props: WidgetProps): React.ReactElement | null {
  return WIDGET_META.find((w) => w.id === id)?.render(props) ?? null;
}

/** Grid layout for a given container width: the number of equal columns that
 *  fit at CELL_MIN, and the resulting cell width/height. Row height tracks cell
 *  width (so widgets scale with the window) but is bounded to [ROW_MIN, ROW_MAX]
 *  so a whole widget always fits yet a single wide column can't fill the
 *  screen. Falls back to one column until the width has been measured. */
function gridMetricsFor(gridWidth: number): { cols: number; cellWidth: number; rowHeight: number } {
  const cols = gridWidth > 0 ? Math.max(1, Math.floor((gridWidth + GAP) / (CELL_MIN + GAP))) : 1;
  const cellWidth = Math.max(0, (gridWidth - (cols - 1) * GAP) / cols);
  const rowHeight = clamp(cellWidth * ROW_RATIO, ROW_MIN, ROW_MAX);
  return { cols, cellWidth, rowHeight };
}

/** Track the widget grid's pixel width so column count + row height follow the
 *  window (rendering) and resize drags can snap to whole cells (startResize).
 *  Uses a callback ref so the ResizeObserver attaches whenever the grid mounts
 *  — the grid renders only after the layout loads, so a plain mount effect
 *  would fire while the node is still absent and never measure it. */
function useGridMetrics(): { ref: (node: HTMLDivElement | null) => void; node: React.RefObject<HTMLDivElement | null>; cols: number; rowHeight: number } {
  const node = useRef<HTMLDivElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const [width, setWidth] = useState(0);

  const ref = useCallback((el: HTMLDivElement | null) => {
    node.current = el;
    observer.current?.disconnect();
    if (!el) return;
    observer.current = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    observer.current.observe(el);
    setWidth(el.clientWidth);
  }, []);

  const { cols, rowHeight } = gridMetricsFor(width);
  return { ref, node, cols, rowHeight };
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
  const [sizes, setSizes] = useState<Partial<Record<WidgetId, WidgetSize>>>({});
  // Live span while dragging a resize handle (not yet persisted).
  const [drag, setDrag] = useState<{ id: WidgetId; w: number; h: number } | null>(null);

  const { ref: gridRef, node: gridNode, cols, rowHeight } = useGridMetrics();

  useEffect(() => {
    let cancelled = false;
    config
      .read<HomeConfig>(HOME_CONFIG_FILE)
      .then((cfg) => {
        if (cancelled) return;
        setWidgets(sanitize(cfg?.widgets));
        setSizes(cfg?.sizes ?? {});
      })
      .catch(() => {
        if (!cancelled) setWidgets(DEFAULT_WIDGETS);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(
    (nextWidgets: WidgetId[], nextSizes: Partial<Record<WidgetId, WidgetSize>>) => {
      setWidgets(nextWidgets);
      setSizes(nextSizes);
      void config
        .write(HOME_CONFIG_FILE, { widgets: nextWidgets, sizes: nextSizes } satisfies HomeConfig)
        .catch((e) => onError(String(e)));
    },
    [onError],
  );

  // Drag-to-resize: the widget's bottom-right corner snaps to whichever cell the
  // cursor is over. Spans are measured from the widget's fixed top-left origin
  // (which doesn't move as it grows) using the grid's live pixel size — so a
  // cell only changes when the cursor actually crosses into the next cell.
  const startResize = useCallback(
    (id: WidgetId, e: React.PointerEvent) => {
      if (!widgets) return;
      e.preventDefault();
      e.stopPropagation();

      const widgetEl = (e.currentTarget as HTMLElement).parentElement;
      const gridEl = gridNode.current;
      if (!widgetEl || !gridEl) return;
      const origin = widgetEl.getBoundingClientRect();
      const { cols: liveCols, cellWidth, rowHeight } = gridMetricsFor(gridEl.getBoundingClientRect().width);
      if (cellWidth <= 0) return;

      const move = (ev: PointerEvent) => {
        // Which cell (1-based) from the origin the cursor currently sits in.
        const w = clamp(Math.floor((ev.clientX - origin.left) / (cellWidth + GAP)) + 1, 1, liveCols);
        const h = clamp(Math.floor((ev.clientY - origin.top) / (rowHeight + GAP)) + 1, 1, MAX_H_SPAN);
        setDrag({ id, w, h });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        setDrag((d) => {
          if (d && widgets.includes(d.id)) {
            persist(widgets, { ...sizes, [d.id]: { w: d.w, h: d.h } });
          }
          return null;
        });
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [widgets, sizes, gridNode, persist],
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
    persist(next, sizes);
  };
  const remove = (id: WidgetId) => {
    const { [id]: _dropped, ...rest } = sizes;
    persist(
      widgets.filter((w) => w !== id),
      rest,
    );
  };
  const add = (id: WidgetId) => persist([...widgets, id], sizes);
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
        <div
          ref={gridRef}
          className={`home-widgets${drag ? " resizing" : ""}`}
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridAutoRows: `${rowHeight}px`,
            ["--home-cols" as string]: cols,
            ["--home-row" as string]: `${rowHeight}px`,
          }}
        >
          {widgets.map((id, index) => {
            const size = drag?.id === id ? drag : normSize(sizes[id]);
            return (
              <section
                key={id}
                className={`widget${drag?.id === id ? " is-resizing" : ""}`}
                style={{
                  gridColumn: `span ${Math.min(size.w, cols)}`,
                  gridRow: `span ${size.h}`,
                }}
              >
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
                <div
                  className="widget-resize"
                  title="Drag to resize"
                  aria-label="Resize widget"
                  onPointerDown={(e) => startResize(id, e)}
                />
              </section>
            );
          })}
        </div>
      )}
    </ViewFrame>
  );
}
