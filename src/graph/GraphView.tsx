/**
 * Graph view (Phase 2 step 4) — the whole vault's link structure as an
 * Obsidian-style node/edge graph. Notes are nodes (dots + labels); resolved
 * `[[links]]` are directed edges. Data comes entirely through `services` (the
 * `links` module derives it in Rust); React never touches IPC.
 *
 * Rendered with `sigma` + `graphology` (LOCKED, chosen for scale — CLAUDE.md §8.4)
 * driven IMPERATIVELY inside this effect via a ref, NOT a React wrapper: sigma
 * owns its WebGL canvas and a per-frame render loop that React's reconciler must
 * stay out of. The ForceAtlas2 layout — the actual bottleneck, not rendering —
 * runs in a Web Worker (`graphology-layout-forceatlas2/worker`) so a few-thousand
 * -node vault never freezes the UI thread while it settles.
 *
 * The info/settings panel (Alt+I, or the corner button) is React and talks to the
 * live sigma/graph/layout instances through refs — it never rebuilds them.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import Graph from "graphology";
import Sigma from "sigma";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import { inferSettings } from "graphology-layout-forceatlas2";

import { config, links } from "../services";
import { useViewState } from "../store/viewState";
import { useTheme } from "../store/theme";
import { ViewFrame } from "@/components/ViewFrame";
import { GraphInfoPanel, type GraphStats } from "./GraphInfoPanel";
import { drawNodeLabelBelow, drawNodeHoverBelow } from "./nodeLabel";

/** Vault-scoped file the graph persists its view settings to (through Rust). */
const GRAPH_VIEW_CONFIG = "graph-view.json";

/** Node fill — a single accent that reads on the (light) shell background; nodes
 *  are deliberately uniform dots, so scale/importance is shown by size, not color. */
const NODE_COLOR = "#5b8def";

/** Node label text colour, per theme. Sigma resolves labels from the
 *  `labelColor` setting; the default `#000` is unreadable on the dark shell, so
 *  we switch to near-white there. (Hover labels sit on a white pill and stay
 *  dark in both themes — only the toggled-on labels need this.) */
const LABEL_COLOR_LIGHT = "#000";
const LABEL_COLOR_DARK = "#e4e4e7";

/** Node sizing. Sigma v3 hit-tests via pixel-perfect WebGL color-picking, so a
 *  node's clickable area == its drawn size (there's no separate hit radius). A
 *  generous base therefore does double duty: bigger dots AND an easier click
 *  target. Hubs grow on top via sqrt(degree) so very linked notes don't balloon.
 *  The user-facing "node size" slider multiplies this per-node base. */
const NODE_BASE_SIZE = 8;
const NODE_DEGREE_SCALE = 2.5;

/** Settings defaults (also the panel's reset baseline). */
const DEFAULT_SHOW_LABELS = true;
const DEFAULT_NODE_SIZE_SCALE = 1;
const DEFAULT_EDGE_LENGTH = 1;

/** Persisted graph view state (CLAUDE.md §5.2: `.vault/config/graph-view.json`).
 *  Camera + the panel's display settings; filters/pinned positions are future
 *  extensions of this same document. */
interface GraphViewSettings {
  camera?: { x: number; y: number; ratio: number; angle: number };
  showLabels?: boolean;
  nodeSizeScale?: number;
  edgeLength?: number;
}

type Status = "loading" | "ready" | "empty" | "error";

export function GraphView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const openNote = useViewState((s) => s.openNote);
  const resolvedTheme = useTheme((s) => s.resolved);
  const panelOpen = useViewState((s) => s.graphInspectorOpen);
  const togglePanel = useViewState((s) => s.toggleGraphInspector);
  const setPanelOpen = useViewState((s) => s.setGraphInspectorOpen);

  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<GraphStats>({ nodes: 0, links: 0, leaves: 0 });
  const [showLabels, setShowLabels] = useState(DEFAULT_SHOW_LABELS);
  const [nodeSizeScale, setNodeSizeScale] = useState(DEFAULT_NODE_SIZE_SCALE);
  const [edgeLength, setEdgeLength] = useState(DEFAULT_EDGE_LENGTH);

  // Live instances, reachable by the panel's handlers without rebuilding them.
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  // Current label colour, kept in a ref so the (theme-independent) build effect
  // can read the live value at construction without re-running on theme change.
  const labelColorRef = useRef(resolvedTheme === "dark" ? LABEL_COLOR_DARK : LABEL_COLOR_LIGHT);
  const layoutRef = useRef<FA2Layout | null>(null);
  // Full persisted settings (camera + display) — the single object we write, so
  // saving one field never clobbers another.
  const settingsRef = useRef<GraphViewSettings>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const layoutStopRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  /** Debounced write of the whole settings object through Rust. Best-effort — a
   *  failed write leaves the live view intact; these are rebuildable preferences. */
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void config.write(GRAPH_VIEW_CONFIG, settingsRef.current).catch(() => {});
    }, 500);
  }, []);

  /**
   * "Line length" = how far apart connected nodes are drawn. sigma's `autoRescale`
   * refits the layout's bounding box to the viewport every frame, so simply
   * spreading nodes (e.g. via the force layout) is normalized away and looks
   * unchanged. We instead override the normalization region: a `customBBox`
   * smaller than the real node extent maps the graph to MORE than the viewport,
   * so edges render longer (node sizes are screen-referenced, so they stay put).
   * spread = 1 clears it (back to plain auto-fit).
   */
  const applyEdgeLength = useCallback((spread: number) => {
    const s = sigmaRef.current;
    if (!s) return;
    if (Math.abs(spread - 1) < 1e-3) {
      s.setCustomBBox(null);
    } else {
      const bbox = s.getBBox(); // raw node extent, independent of any customBBox
      const cx = (bbox.x[0] + bbox.x[1]) / 2;
      const cy = (bbox.y[0] + bbox.y[1]) / 2;
      const hw = ((bbox.x[1] - bbox.x[0]) || 1) / 2;
      const hh = ((bbox.y[1] - bbox.y[0]) || 1) / 2;
      s.setCustomBBox({
        x: [cx - hw / spread, cx + hw / spread],
        y: [cy - hh / spread, cy + hh / spread],
      });
    }
    s.refresh(); // recompute the normalization (setCustomBBox only schedules a render)
  }, []);

  /** Run the force layout off the main thread; once it settles (bounded so it
   *  never pins a CPU core), apply the saved line-length spread. `kill` on
   *  unmount tears the worker down regardless. */
  const runLayout = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;
    layoutRef.current?.kill();
    const layout = new FA2Layout(graph, { settings: inferSettings(graph) });
    layoutRef.current = layout;
    layout.start();
    if (layoutStopRef.current) clearTimeout(layoutStopRef.current);
    layoutStopRef.current = setTimeout(() => {
      layout.stop();
      applyEdgeLength(settingsRef.current.edgeLength ?? DEFAULT_EDGE_LENGTH);
    }, Math.min(8000, 2000 + graph.order * 3));
  }, [applyEdgeLength]);

  const onToggleLabels = useCallback(
    (next: boolean) => {
      setShowLabels(next);
      settingsRef.current.showLabels = next;
      sigmaRef.current?.setSetting("renderLabels", next);
      scheduleSave();
    },
    [scheduleSave],
  );

  const onNodeSize = useCallback(
    (scale: number) => {
      setNodeSizeScale(scale);
      settingsRef.current.nodeSizeScale = scale;
      // Re-derive each node's drawn size from its stored base — one batched pass
      // (a per-node write would emit N graphology events and thrash sigma).
      graphRef.current?.updateEachNodeAttributes(
        (_n, attr) => {
          attr.size = ((attr.baseSize as number) ?? NODE_BASE_SIZE) * scale;
          return attr;
        },
        { attributes: ["size"] },
      );
      scheduleSave();
    },
    [scheduleSave],
  );

  const onEdgeLength = useCallback(
    (length: number) => {
      setEdgeLength(length);
      settingsRef.current.edgeLength = length;
      applyEdgeLength(length); // instant — just re-normalizes, no relayout
      scheduleSave();
    },
    [applyEdgeLength, scheduleSave],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let sigma: Sigma | undefined;
    let cancelled = false;
    // Ends an in-progress node drag; kept at effect scope so cleanup can detach
    // the window-level mouseup listener it's registered on.
    let endDrag: (() => void) | undefined;

    void (async () => {
      try {
        const [data, saved] = await Promise.all([
          links.graph(),
          config.read<GraphViewSettings>(GRAPH_VIEW_CONFIG),
        ]);
        if (cancelled) return;

        if (data.nodes.length === 0) {
          setStatus("empty");
          return;
        }

        // Merge saved settings over defaults and reflect them in the panel state.
        const initShowLabels = saved?.showLabels ?? DEFAULT_SHOW_LABELS;
        const initNodeScale = saved?.nodeSizeScale ?? DEFAULT_NODE_SIZE_SCALE;
        const initEdgeLength = saved?.edgeLength ?? DEFAULT_EDGE_LENGTH;
        settingsRef.current = {
          camera: saved?.camera,
          showLabels: initShowLabels,
          nodeSizeScale: initNodeScale,
          edgeLength: initEdgeLength,
        };
        setShowLabels(initShowLabels);
        setNodeSizeScale(initNodeScale);
        setEdgeLength(initEdgeLength);

        // Build the graphology model. Seed random positions so ForceAtlas2 has
        // something to relax from (it needs x/y on every node).
        const graph = new Graph();
        graphRef.current = graph;
        for (const node of data.nodes) {
          graph.addNode(node.id, {
            label: node.title || "Untitled",
            x: Math.random(),
            y: Math.random(),
            size: NODE_BASE_SIZE,
            baseSize: NODE_BASE_SIZE,
            color: NODE_COLOR,
          });
        }
        for (const edge of data.edges) {
          // Guard against a stale cache referencing a node that isn't in this
          // snapshot, and collapse any duplicate direction into one edge.
          if (
            graph.hasNode(edge.source) &&
            graph.hasNode(edge.target) &&
            !graph.hasDirectedEdge(edge.source, edge.target)
          ) {
            graph.addDirectedEdge(edge.source, edge.target);
          }
        }

        // Size nodes by degree so hubs read as bigger dots (sqrt keeps very
        // linked notes from ballooning); remember the base so the node-size
        // slider can rescale from it. Apply the saved scale up front.
        let leaves = 0;
        graph.forEachNode((node) => {
          const degree = graph.degree(node);
          if (degree === 0) leaves++;
          const base = NODE_BASE_SIZE + Math.sqrt(degree) * NODE_DEGREE_SCALE;
          graph.setNodeAttribute(node, "baseSize", base);
          graph.setNodeAttribute(node, "size", base * initNodeScale);
        });
        setStats({ nodes: graph.order, links: graph.size, leaves });

        sigma = new Sigma(graph, container, {
          allowInvalidContainer: true,
          labelDensity: 0.6,
          labelRenderedSizeThreshold: 8,
          defaultNodeColor: NODE_COLOR,
          labelColor: { color: labelColorRef.current },
          renderLabels: initShowLabels,
          // Draw the note title centered directly under the node.
          defaultDrawNodeLabel: drawNodeLabelBelow,
          defaultDrawNodeHover: drawNodeHoverBelow,
        });
        sigmaRef.current = sigma;

        // Restore camera zoom/position BEFORE wiring the save listener, so
        // applying it doesn't immediately trigger a redundant write.
        if (saved?.camera) {
          sigma.getCamera().setState(saved.camera);
        }

        // Hover: highlight the hovered node and its neighbors, fade the rest.
        let hovered: string | null = null;
        const neighbors = new Set<string>();
        sigma.on("enterNode", ({ node }) => {
          hovered = node;
          neighbors.clear();
          graph.forEachNeighbor(node, (n) => neighbors.add(n));
          sigma?.refresh();
        });
        sigma.on("leaveNode", () => {
          hovered = null;
          neighbors.clear();
          sigma?.refresh();
        });
        sigma.setSetting("nodeReducer", (node, attrs) => {
          if (hovered === null || node === hovered || neighbors.has(node)) return attrs;
          return { ...attrs, color: "#d4d4d8", label: "" };
        });
        sigma.setSetting("edgeReducer", (edge, attrs) => {
          if (hovered === null) return attrs;
          const [s, t] = graph.extremities(edge);
          if (s === hovered || t === hovered) return attrs;
          return { ...attrs, hidden: true };
        });

        // --- Node dragging (sigma has no built-in drag) --------------------
        // Press-and-move over a node pins it to the cursor; a lightweight spring
        // relaxation (running only while dragging) lets the connected notes trail
        // after it with soft, flowy motion instead of moving as a rigid block.
        // FA2 can't drive this — its worker owns an internal position matrix and
        // overwrites the graph each tick, so it ignores a pinned node — hence this
        // small self-contained sim.
        let draggedNode: string | null = null;
        // True once the pointer actually moves after pressing a node — lets us
        // tell a drag from a click so releasing a drag doesn't open the note.
        let dragMoved = false;
        let lastMouse: { x: number; y: number } | null = null;
        let rafId: number | undefined;
        // Authoritative position/velocity/force state for the sim, owned here for
        // the whole drag (FA2 is stopped, so nothing else writes positions). Kept
        // in reused maps and written back to the graph in ONE batched pass per
        // frame — per-node graph writes would each emit a graphology event and
        // make sigma re-react N times a frame, which is what caused the jitter.
        const px = new Map<string, number>();
        const py = new Map<string, number>();
        const vx = new Map<string, number>();
        const vy = new Map<string, number>();
        const fx = new Map<string, number>();
        const fy = new Map<string, number>();
        const restLength = new Map<string, number>();
        const mouseCaptor = sigma.getMouseCaptor();

        // One physics frame: pin the dragged node, pull every edge toward the
        // length it had when the drag began, integrate with damping. Edges at rest
        // exert no force, so only the dragged node's connected component moves.
        const SPRING = 0.05; // stiffness
        const DAMPING = 0.8; // velocity kept per frame (< 1 so motion settles)
        function step() {
          if (!draggedNode || !sigma) return;
          if (lastMouse) {
            px.set(draggedNode, lastMouse.x);
            py.set(draggedNode, lastMouse.y);
          }
          fx.clear();
          fy.clear();
          graph.forEachEdge((edge, _attr, s, t) => {
            const dx = (px.get(t) ?? 0) - (px.get(s) ?? 0);
            const dy = (py.get(t) ?? 0) - (py.get(s) ?? 0);
            const dist = Math.hypot(dx, dy) || 1e-6;
            const rest = restLength.get(edge) ?? dist;
            const f = (SPRING * (dist - rest)) / dist;
            const ux = dx * f;
            const uy = dy * f;
            fx.set(s, (fx.get(s) ?? 0) + ux);
            fy.set(s, (fy.get(s) ?? 0) + uy);
            fx.set(t, (fx.get(t) ?? 0) - ux);
            fy.set(t, (fy.get(t) ?? 0) - uy);
          });
          // Integrate into the local maps (no graph writes yet).
          for (const n of px.keys()) {
            if (n === draggedNode) continue;
            const nvx = ((vx.get(n) ?? 0) + (fx.get(n) ?? 0)) * DAMPING;
            const nvy = ((vy.get(n) ?? 0) + (fy.get(n) ?? 0)) * DAMPING;
            vx.set(n, nvx);
            vy.set(n, nvy);
            px.set(n, (px.get(n) ?? 0) + nvx);
            py.set(n, (py.get(n) ?? 0) + nvy);
          }
          // Single batched write → one graphology event → one sigma refresh.
          graph.updateEachNodeAttributes(
            (n, attr) => {
              attr.x = px.get(n) ?? attr.x;
              attr.y = py.get(n) ?? attr.y;
              return attr;
            },
            { attributes: ["x", "y"] },
          );
          rafId = requestAnimationFrame(step);
        }

        sigma.on("downNode", ({ node }) => {
          draggedNode = node;
          dragMoved = false;
          lastMouse = null;
          graph.setNodeAttribute(node, "highlighted", true);
          // Take manual control — stop FA2 so it doesn't fight the drag.
          if (layoutStopRef.current) clearTimeout(layoutStopRef.current);
          layoutRef.current?.stop();
          // Seed the sim from the current settled layout: node positions, zero
          // velocities, and each edge's current length as its spring rest length.
          px.clear();
          py.clear();
          vx.clear();
          vy.clear();
          graph.forEachNode((n) => {
            px.set(n, graph.getNodeAttribute(n, "x"));
            py.set(n, graph.getNodeAttribute(n, "y"));
          });
          restLength.clear();
          graph.forEachEdge((edge, _attr, s, t) => {
            const dx = (px.get(t) ?? 0) - (px.get(s) ?? 0);
            const dy = (py.get(t) ?? 0) - (py.get(s) ?? 0);
            restLength.set(edge, Math.hypot(dx, dy));
          });
          rafId = requestAnimationFrame(step);
        });

        mouseCaptor.on("mousemovebody", (e) => {
          if (!draggedNode || !sigma) return;
          dragMoved = true;
          lastMouse = sigma.viewportToGraph(e);
          // Stop sigma from also panning the camera while dragging a node.
          e.preventSigmaDefault();
          e.original.preventDefault();
          e.original.stopPropagation();
        });

        // Open the note on a genuine click, but NOT at the end of a drag.
        sigma.on("clickNode", ({ node }) => {
          if (dragMoved) return;
          openNote(node);
        });

        endDrag = () => {
          if (rafId !== undefined) cancelAnimationFrame(rafId);
          rafId = undefined;
          if (draggedNode) graph.removeNodeAttribute(draggedNode, "highlighted");
          draggedNode = null;
          lastMouse = null;
        };
        mouseCaptor.on("mouseup", endDrag);
        // Releasing the button outside the canvas must still end the drag.
        window.addEventListener("mouseup", endDrag);

        // Persist camera changes (pan/zoom), debounced, through Rust.
        sigma.getCamera().on("updated", (state) => {
          settingsRef.current.camera = state;
          scheduleSave();
        });

        // Run the force layout OFF the main thread. `runLayout` applies the saved
        // line-length spread once it settles.
        runLayout();

        setStatus("ready");
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (layoutStopRef.current) clearTimeout(layoutStopRef.current);
      if (endDrag) {
        window.removeEventListener("mouseup", endDrag);
        endDrag(); // cancel any in-flight drag animation frame
      }
      layoutRef.current?.kill();
      layoutRef.current = null;
      sigma?.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, [openNote, runLayout, scheduleSave]);

  // Keep label colour in step with the theme without rebuilding sigma. Updates
  // the ref (read by the build effect on first mount) and, if sigma is already
  // live, pushes the new colour and repaints.
  useEffect(() => {
    const color = resolvedTheme === "dark" ? LABEL_COLOR_DARK : LABEL_COLOR_LIGHT;
    labelColorRef.current = color;
    const s = sigmaRef.current;
    if (s) {
      s.setSetting("labelColor", { color });
      s.refresh();
    }
  }, [resolvedTheme]);

  return (
    <ViewFrame
      title="Graph"
      fullBleed
      actions={
        status === "ready" &&
        !panelOpen && (
          <button
            className="graph-panel-toggle"
            onClick={togglePanel}
            title="Graph info & settings (Alt+I)"
            aria-label="Open graph info panel"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        )
      }
    >
      <div className="graph-view">
        {status === "empty" && (
          <div className="centered muted">
            No links yet — connect notes with <code>[[links]]</code> to see them here.
          </div>
        )}
        {status === "error" && <div className="centered error">Couldn't load the graph: {error}</div>}
        <div
          ref={containerRef}
          className="graph-canvas"
          style={{ visibility: status === "ready" ? "visible" : "hidden" }}
        />

        {status === "ready" && panelOpen && (
          <GraphInfoPanel
            stats={stats}
            showLabels={showLabels}
            nodeSizeScale={nodeSizeScale}
            edgeLength={edgeLength}
            onToggleLabels={onToggleLabels}
            onNodeSize={onNodeSize}
            onEdgeLength={onEdgeLength}
            onClose={() => setPanelOpen(false)}
          />
        )}
      </div>
    </ViewFrame>
  );
}
