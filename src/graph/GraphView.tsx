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

        // Click-to-open: open the note and switch to the editor view.
        sigma.on("clickNode", ({ node }) => openNote(node));

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
