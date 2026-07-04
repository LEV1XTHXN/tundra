/**
 * Graph view (Phase 2 step 4) — the whole vault's link structure as an
 * Obsidian-style node/edge graph. Notes are nodes (dots + labels, no per-note
 * icons); resolved `[[links]]` are directed edges. Data comes entirely through
 * `services` (the `links` module derives it in Rust); React never touches IPC.
 *
 * Rendered with `sigma` + `graphology` (LOCKED, chosen for scale — CLAUDE.md §8.4)
 * driven IMPERATIVELY inside this effect via a ref, NOT a React wrapper: sigma
 * owns its WebGL canvas and a per-frame render loop that React's reconciler must
 * stay out of. The ForceAtlas2 layout — the actual bottleneck, not rendering —
 * runs in a Web Worker (`graphology-layout-forceatlas2/worker`) so a few-thousand
 * -node vault never freezes the UI thread while it settles.
 */
import { useEffect, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import { inferSettings } from "graphology-layout-forceatlas2";

import { config, links } from "../services";
import { useViewState } from "../store/viewState";

/** Vault-scoped file the graph persists its view settings to (through Rust). */
const GRAPH_VIEW_CONFIG = "graph-view.json";

/** Node fill — a single accent that reads on the (light) shell background; nodes
 *  are deliberately uniform dots, so scale/importance is shown by size, not color. */
const NODE_COLOR = "#5b8def";

/** Node sizing. Sigma v3 hit-tests via pixel-perfect WebGL color-picking, so a
 *  node's clickable area == its drawn size (there's no separate hit radius). A
 *  generous base therefore does double duty: bigger dots AND an easier click
 *  target. Hubs grow on top via sqrt(degree) so very linked notes don't balloon. */
const NODE_BASE_SIZE = 8;
const NODE_DEGREE_SCALE = 2.5;

/** Persisted graph view state (CLAUDE.md §5.2: `.vault/config/graph-view.json`).
 *  Camera position/zoom for now; filters/pinned positions are future extensions
 *  of this same document. */
interface GraphViewSettings {
  camera?: { x: number; y: number; ratio: number; angle: number };
}

type Status = "loading" | "ready" | "empty" | "error";

export function GraphView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const openNote = useViewState((s) => s.openNote);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let sigma: Sigma | undefined;
    let layout: FA2Layout | undefined;
    let cancelled = false;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
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

        // Build the graphology model. Seed random positions so ForceAtlas2 has
        // something to relax from (it needs x/y on every node).
        const graph = new Graph();
        for (const node of data.nodes) {
          graph.addNode(node.id, {
            label: node.title || "Untitled",
            x: Math.random(),
            y: Math.random(),
            size: NODE_BASE_SIZE,
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
        // linked notes from ballooning).
        graph.forEachNode((node) => {
          const degree = graph.degree(node);
          graph.setNodeAttribute(node, "size", NODE_BASE_SIZE + Math.sqrt(degree) * NODE_DEGREE_SCALE);
        });

        sigma = new Sigma(graph, container, {
          allowInvalidContainer: true,
          labelDensity: 0.6,
          labelRenderedSizeThreshold: 8,
          defaultNodeColor: NODE_COLOR,
        });

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
          if (stopTimer) clearTimeout(stopTimer);
          layout?.stop();
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
          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = setTimeout(() => {
            void config.write(GRAPH_VIEW_CONFIG, { camera: state } as GraphViewSettings).catch(() => {
              /* view settings are best-effort UI state — never block on them */
            });
          }, 500);
        });

        // Run the force layout OFF the main thread. Stop it once it has settled
        // (bounded by graph size) so it doesn't pin a CPU core indefinitely;
        // `kill` on unmount tears the worker down regardless.
        layout = new FA2Layout(graph, { settings: inferSettings(graph) });
        layout.start();
        stopTimer = setTimeout(() => layout?.stop(), Math.min(8000, 2000 + graph.order * 3));

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
      if (saveTimer) clearTimeout(saveTimer);
      if (stopTimer) clearTimeout(stopTimer);
      if (endDrag) {
        window.removeEventListener("mouseup", endDrag);
        endDrag(); // cancel any in-flight drag animation frame
      }
      layout?.kill();
      sigma?.kill();
    };
  }, [openNote]);

  return (
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
    </div>
  );
}
