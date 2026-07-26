/**
 * Home dashboard — the landing view. Shows user-configurable widgets
 * (Search / Pinned / Recent / Quick capture / Calendar / Clock / Storage /
 * Streak / Graph) laid out on a real draggable + resizable grid (in an
 * explicit "Customize" edit mode) via `react-grid-layout` (MIT). Every
 * widget's position (x/y/w/h in grid cells) persists to
 * `.vault/config/home.json` alongside which widgets are enabled and the
 * page's background customization — THROUGH RUST (`services.config`), never
 * localStorage. React renders; all data + persistence go through `services`.
 */
import { Suspense, lazy, useEffect, useState } from "react";
import {
  CalendarDays,
  Clock as ClockIcon,
  Database,
  Flame,
  History,
  LayoutGrid,
  NotebookPen,
  Palette,
  Pin,
  Plus,
  Search as SearchIcon,
  Waypoints,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import GridLayout, { useContainerWidth } from "react-grid-layout";
import type { Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";

import { config } from "@/services";
import { ViewFrame } from "@/components/ViewFrame";
import { useHomeBackground } from "@/store/homeBackground";
import { HomeBackgroundPicker, type HomeBackground } from "./HomeBackgroundPicker";
import { WidgetAddMenu } from "./WidgetAddMenu";
import {
  CalendarWidget,
  ClockWidget,
  PinnedWidget,
  QuickCaptureWidget,
  RecentWidget,
  SearchWidget,
  StorageWidget,
  StreakWidget,
  type WidgetProps,
} from "./widgets";

// Split out (like App.tsx's own `GraphView`) so `sigma`/`graphology` — a heavy
// WebGL lib — aren't eagerly bundled into Home's landing-view chunk.
const MiniGraphWidget = lazy(() =>
  import("./MiniGraphWidget").then((m) => ({ default: m.MiniGraphWidget })),
);

type WidgetId =
  | "search"
  | "pinned"
  | "recent"
  | "quickCapture"
  | "calendar"
  | "clock"
  | "storage"
  | "streak"
  | "miniGraph";

/** One widget's position + span on the grid, in whole cells. */
interface GridPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface HomeConfig {
  widgets: WidgetId[];
  /** Explicit per-widget grid position; a widget without an entry here (a
   *  brand-new vault, or a freshly re-added widget) falls back to `DEFAULT_POS`. */
  layout: Partial<Record<WidgetId, GridPos>>;
  background: HomeBackground | null;
  /** No gap between widgets (react-grid-layout margin → 0), so adjacent ones
   *  sit edge-to-edge. Independent of `frameless` — the two combine for a
   *  "stuck together, one surface" look, but either works alone. */
  flush: boolean;
  /** Widgets lose their card border/background/padding, so they blend into
   *  the page (and into each other, when also `flush`) instead of reading as
   *  separate boxes. */
  frameless: boolean;
}

const HOME_CONFIG_FILE = "home.json";

/** Grid geometry. A cell is sized to comfortably hold a SMALL widget at its
 *  minimum span (CELL_MIN wide, ~square tall) — the board fits as many such
 *  columns as the window allows, and every column is an equal `1fr` so
 *  widgets scale proportionally with the window. GAP feeds
 *  `react-grid-layout`'s own `margin` config, so there's no separate CSS gap
 *  to keep in sync. Half the size of an earlier pass at this constant (300/
 *  240) — halved together with `DEFAULT_POS` below (every span doubled) so
 *  the default dashboard still LOOKS the same at a given window width, while
 *  every widget's resize floor (~half its default span, see `MIN_SIZE`) now
 *  bottoms out at roughly half the physical size it used to. */
const CELL_MIN = 150; // px — minimum width of one cell (drives the column count)
const ROW_RATIO = 1.15; // row height per cell-width unit (tall enough for the calendar)
const ROW_MIN = 120; // px — floor so a 1×1 cell always fits a small widget
const ROW_MAX = 460; // px — cap so a wide single-column layout can't fill the screen
const GAP = 16; // px — react-grid-layout margin

interface WidgetMeta {
  id: WidgetId;
  title: string;
  description: string;
  icon: LucideIcon;
  render: (p: WidgetProps) => React.ReactElement;
}

const WIDGET_META: WidgetMeta[] = [
  {
    id: "search",
    title: "Search",
    description: "Find notes by text or #tag",
    icon: SearchIcon,
    render: (p) => <SearchWidget {...p} />,
  },
  {
    id: "pinned",
    title: "Pinned",
    description: "Notes you've pinned",
    icon: Pin,
    render: (p) => <PinnedWidget {...p} />,
  },
  {
    id: "recent",
    title: "Recent",
    description: "Recently edited notes",
    icon: History,
    render: (p) => <RecentWidget {...p} />,
  },
  {
    id: "quickCapture",
    title: "Quick capture",
    description: "Jot a thought into Quick notes",
    icon: NotebookPen,
    render: (p) => <QuickCaptureWidget {...p} />,
  },
  {
    id: "calendar",
    title: "Calendar",
    description: "A compact month view",
    icon: CalendarDays,
    render: (p) => <CalendarWidget {...p} />,
  },
  {
    id: "clock",
    title: "Clock",
    description: "Local time and date",
    icon: ClockIcon,
    render: (p) => <ClockWidget {...p} />,
  },
  {
    id: "storage",
    title: "Storage",
    description: "Note, tag, and group counts",
    icon: Database,
    render: (p) => <StorageWidget {...p} />,
  },
  {
    id: "streak",
    title: "Streak",
    description: "Consecutive days logged in",
    icon: Flame,
    render: (p) => <StreakWidget {...p} />,
  },
  {
    id: "miniGraph",
    title: "Graph",
    description: "A preview of your link graph",
    icon: Waypoints,
    render: (p) => (
      <Suspense fallback={<div className="centered muted">Loading…</div>}>
        <MiniGraphWidget {...p} />
      </Suspense>
    ),
  },
];

const DEFAULT_WIDGETS: WidgetId[] = [
  "search",
  "pinned",
  "recent",
  "quickCapture",
  "calendar",
  "clock",
  "storage",
  "streak",
  "miniGraph",
];

/** Seed position for a widget with no saved layout yet (a brand-new vault, or
 *  a widget just re-added via "+ Add widget") — hand-authored against a
 *  6-column baseline (every span DOUBLED from a 3-column original, matching
 *  CELL_MIN/ROW_MIN being halved above, so the default dashboard still looks
 *  the same at a given window width). Not pixel-perfect at every window
 *  width: RGL's own bounds-correction + vertical compaction (see
 *  `synchronizeLayoutWithChildren` in the library) re-pack anything that
 *  doesn't fit the ACTUAL column count on mount, so this only has to be a
 *  reasonable starting arrangement, not a responsive one. */
const DEFAULT_POS: Partial<Record<WidgetId, GridPos>> = {
  search: { x: 0, y: 0, w: 6, h: 2 },
  pinned: { x: 0, y: 2, w: 2, h: 4 },
  recent: { x: 2, y: 2, w: 2, h: 4 },
  quickCapture: { x: 4, y: 2, w: 2, h: 2 },
  clock: { x: 4, y: 4, w: 2, h: 2 },
  calendar: { x: 0, y: 6, w: 2, h: 4 },
  storage: { x: 2, y: 6, w: 2, h: 2 },
  streak: { x: 4, y: 6, w: 2, h: 2 },
  miniGraph: { x: 2, y: 8, w: 4, h: 4 },
};

/** A widget can be resized down to ~half its default span (rounded, floored
 *  at 1 cell — the grid's resolution itself stays as coarse as `DEFAULT_POS`;
 *  this is a resize FLOOR, not a finer grid). Derived from `DEFAULT_POS`
 *  rather than hand-duplicated so the two can never drift apart. */
function halfFloor(n: number): number {
  return Math.max(1, Math.round(n / 2));
}
const MIN_SIZE: Partial<Record<WidgetId, { minW: number; minH: number }>> = Object.fromEntries(
  Object.entries(DEFAULT_POS).map(([id, pos]) => [id, { minW: halfFloor(pos!.w), minH: halfFloor(pos!.h) }]),
);

/** Keep only known widget ids, de-duplicated; fall back to the default layout
 *  when there's no saved config (vs. an explicitly emptied one). */
function sanitizeWidgets(ids: WidgetId[] | undefined): WidgetId[] {
  if (!ids) return DEFAULT_WIDGETS;
  const known = new Set(WIDGET_META.map((w) => w.id));
  const seen = new Set<WidgetId>();
  return ids.filter((id) => known.has(id) && !seen.has(id) && (seen.add(id), true));
}

function sanitizeConfig(raw: Partial<HomeConfig> | null): HomeConfig {
  return {
    widgets: sanitizeWidgets(raw?.widgets),
    layout: raw?.layout ?? {},
    background: raw?.background ?? null,
    flush: raw?.flush ?? false,
    frameless: raw?.frameless ?? false,
  };
}

function titleOf(id: WidgetId): string {
  return WIDGET_META.find((w) => w.id === id)?.title ?? id;
}

function renderWidget(id: WidgetId, props: WidgetProps): React.ReactElement | null {
  return WIDGET_META.find((w) => w.id === id)?.render(props) ?? null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Column count + row height for a given container width: as many equal
 *  columns as fit at CELL_MIN, each an equal share of the width. Row height
 *  tracks cell width (so widgets scale with the window) but is bounded to
 *  [ROW_MIN, ROW_MAX] so a whole widget always fits yet a single wide column
 *  can't fill the screen. */
function gridMetricsFor(gridWidth: number): { cols: number; rowHeight: number } {
  const cols = gridWidth > 0 ? Math.max(1, Math.floor((gridWidth + GAP) / (CELL_MIN + GAP))) : 1;
  const cellWidth = Math.max(0, (gridWidth - (cols - 1) * GAP) / cols);
  const rowHeight = clamp(cellWidth * ROW_RATIO, ROW_MIN, ROW_MAX);
  return { cols, rowHeight };
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
  // null = still loading the saved config.
  const [cfg, setCfg] = useState<HomeConfig | null>(null);
  const [editMode, setEditMode] = useState(false);
  const setSharedBackground = useHomeBackground((s) => s.setBackground);

  const { width, mounted: widthMeasured, containerRef } = useContainerWidth();
  const { cols, rowHeight } = gridMetricsFor(width);

  useEffect(() => {
    let cancelled = false;
    // Clear whatever the PREVIOUS vault (or nothing, on first load) left in
    // shared state immediately, rather than leaving it stale until this read
    // resolves — `App.tsx` also checks the value's own `vaultPath` before
    // using it, but clearing here means there's never even a flash of the
    // wrong vault's background while this read is in flight.
    setSharedBackground(null, vaultPath);
    config
      .read<HomeConfig>(HOME_CONFIG_FILE)
      .then((raw) => {
        if (cancelled) return;
        const sanitized = sanitizeConfig(raw);
        setCfg(sanitized);
        // Mirrored into shared UI state so the app SHELL (ribbon + sidebar,
        // outside this component tree) can go frosted-over-background too —
        // see `store/homeBackground.ts`.
        setSharedBackground(sanitized.background, vaultPath);
      })
      .catch(() => {
        if (!cancelled) setCfg(sanitizeConfig(null));
      });
    return () => {
      cancelled = true;
    };
  }, [setSharedBackground, vaultPath]);

  if (cfg === null) {
    return (
      <ViewFrame title="Home">
        <div className="centered muted">Loading…</div>
      </ViewFrame>
    );
  }

  const persist = (next: HomeConfig) => {
    setCfg(next);
    setSharedBackground(next.background, vaultPath);
    void config.write(HOME_CONFIG_FILE, next).catch((e) => onError(String(e)));
  };

  const rglLayout: Layout = cfg.widgets.map((id, index) => {
    const pos = cfg.layout[id] ?? DEFAULT_POS[id] ?? { x: 0, y: index, w: 1, h: 1 };
    const min = MIN_SIZE[id] ?? { minW: 1, minH: 1 };
    return {
      i: id,
      x: pos.x,
      y: pos.y,
      // Clamp a saved size that predates this floor (or an older, smaller
      // per-widget default) up to the current minimum.
      w: Math.max(pos.w, min.minW),
      h: Math.max(pos.h, min.minH),
      minW: min.minW,
      minH: min.minH,
    };
  });

  const handleLayoutChange = (layout: Layout) => {
    if (layout.length === 0) return;
    const nextLayout: Partial<Record<WidgetId, GridPos>> = {};
    for (const item of layout) {
      nextLayout[item.i as WidgetId] = { x: item.x, y: item.y, w: item.w, h: item.h };
    }
    persist({ ...cfg, layout: nextLayout });
  };

  const remove = (id: WidgetId) => {
    const { [id]: _dropped, ...restLayout } = cfg.layout;
    persist({ ...cfg, widgets: cfg.widgets.filter((w) => w !== id), layout: restLayout });
  };
  const add = (id: WidgetId) => persist({ ...cfg, widgets: [...cfg.widgets, id] });
  const setBackground = (background: HomeBackground | null) => persist({ ...cfg, background });
  const toggleFlush = () => persist({ ...cfg, flush: !cfg.flush });
  const toggleFrameless = () => persist({ ...cfg, frameless: !cfg.frameless });

  const available = WIDGET_META.filter((w) => !cfg.widgets.includes(w.id));
  const widgetProps: WidgetProps = { vaultPath, refreshKey, onOpenNote, onError };
  const gap = cfg.flush ? 0 : GAP;

  const actions = (
    <div className="home-actions">
      {editMode && (
        <WidgetAddMenu
          available={available}
          onAdd={(id) => add(id as WidgetId)}
          trigger={
            <button className="home-toolbar-btn" title="Add widget" disabled={available.length === 0}>
              <Plus className="h-3.5 w-3.5" />
              Add widget
            </button>
          }
        />
      )}
      {editMode && (
        <div className="home-style-toggles">
          <button
            className={`home-toolbar-btn${cfg.flush ? " active" : ""}`}
            onClick={toggleFlush}
            title="No gap between widgets"
          >
            Flush
          </button>
          <button
            className={`home-toolbar-btn${cfg.frameless ? " active" : ""}`}
            onClick={toggleFrameless}
            title="No card border/background around widgets"
          >
            Frameless
          </button>
        </div>
      )}
      <HomeBackgroundPicker
        vaultPath={vaultPath}
        background={cfg.background}
        onChange={setBackground}
        onError={onError}
        trigger={
          <button className="home-toolbar-btn" title="Home background" aria-label="Home background">
            <Palette className="h-3.5 w-3.5" />
          </button>
        }
      />
      <button
        className={`home-toolbar-btn${editMode ? " active" : ""}`}
        onClick={() => setEditMode((v) => !v)}
        title={editMode ? "Done customizing" : "Customize layout"}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        {editMode ? "Done" : "Customize"}
      </button>
    </div>
  );

  return (
    <ViewFrame title="Home" actions={actions} headerClassName={cfg.background ? "home-glass" : undefined}>
      {cfg.widgets.length === 0 ? (
        <div className="centered muted">No widgets — turn on Customize to add one.</div>
      ) : (
        <div ref={containerRef} className="home-grid-container">
          {/* Wait for a REAL measurement before mounting the grid at all — react-grid-layout
              bounds-corrects/compacts its layout against whatever `width`/`cols` it mounts
              with, and (like any other layout change) auto-persists that correction via
              `onLayoutChange`. Mounting against `useContainerWidth`'s width-before-measured
              fallback would silently persist a layout recomputed for the WRONG column count —
              this is what was scrambling saved positions on every fresh Home mount (e.g. right
              after switching vaults, since Home unmounts/remounts on every view change). */}
          {!widthMeasured ? (
            <div className="centered muted">Loading…</div>
          ) : (
            // `key={cols}` forces a clean remount when the column count changes
            // (window resized past a breakpoint): GridLayout only bounds-corrects
            // its saved layout against `cols` on mount, so a stale wide layout
            // would otherwise stay un-clamped after the window narrows.
            <GridLayout
              key={cols}
              width={width}
              layout={rglLayout}
              gridConfig={{ cols, rowHeight, margin: [gap, gap], containerPadding: [0, 0] }}
              dragConfig={{ enabled: editMode, handle: ".widget-header", cancel: ".widget-controls" }}
              resizeConfig={{ enabled: editMode }}
              onLayoutChange={handleLayoutChange}
              className={[
                "home-widgets",
                editMode && "editing",
                cfg.background && "has-background",
                cfg.flush && "flush",
                cfg.frameless && "frameless",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{
                ["--home-cols" as string]: cols,
                ["--home-row" as string]: `${rowHeight}px`,
                ["--home-gap" as string]: `${gap}px`,
              }}
            >
              {cfg.widgets.map((id) => (
                <section key={id} className="widget">
                  <div className="widget-header">
                    <h2 className="widget-title">{titleOf(id)}</h2>
                    {editMode && (
                      <div className="widget-controls">
                        <button onClick={() => remove(id)} title="Remove widget" aria-label="Remove widget">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="widget-body">{renderWidget(id, widgetProps)}</div>
                </section>
              ))}
            </GridLayout>
          )}
        </div>
      )}
    </ViewFrame>
  );
}
