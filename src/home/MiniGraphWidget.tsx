/**
 * Home dashboard's mini Graph widget, split into its own module (unlike the
 * other widgets in `widgets.tsx`) so `sigma`/`graphology` — the same heavy
 * WebGL libs the full `graph/GraphView.tsx` lazy-loads — don't end up eagerly
 * bundled into Home's landing-view chunk. `Home.tsx` imports this via
 * `React.lazy`, matching how `App.tsx` lazy-loads `GraphView` itself.
 */
import { useEffect, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import { inferSettings } from "graphology-layout-forceatlas2";

import { links } from "@/services";
import { useViewState } from "@/store/viewState";
import type { WidgetProps } from "./widgets";

const MINI_GRAPH_NODE_COLOR = "#5b8def";
const MINI_GRAPH_NODE_SIZE = 5;
const MINI_GRAPH_NODE_DEGREE_SCALE = 1.6;

/** A compact, non-interactive-camera preview of the vault's link graph
 *  (`graph/GraphView.tsx`'s full editor). Rebuilt fresh each time (no camera
 *  or settings persistence — that's the full view's job); the force layout
 *  runs briefly then stops, same as the full view but on a shorter clock since
 *  the graph is tiny on screen. Clicking a node opens it; clicking the widget
 *  otherwise jumps to the full Graph view. */
export function MiniGraphWidget({ refreshKey, onOpenNote }: WidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const setView = useViewState((s) => s.setView);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let sigma: Sigma | undefined;
    let layout: FA2Layout | undefined;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const data = await links.graph();
        if (cancelled) return;
        if (data.nodes.length === 0) {
          setStatus("empty");
          return;
        }

        const graph = new Graph();
        for (const node of data.nodes) {
          graph.addNode(node.id, {
            label: node.title || "Untitled",
            x: Math.random(),
            y: Math.random(),
            size: MINI_GRAPH_NODE_SIZE,
            color: MINI_GRAPH_NODE_COLOR,
          });
        }
        for (const edge of data.edges) {
          if (
            graph.hasNode(edge.source) &&
            graph.hasNode(edge.target) &&
            !graph.hasDirectedEdge(edge.source, edge.target)
          ) {
            graph.addDirectedEdge(edge.source, edge.target);
          }
        }
        graph.forEachNode((node) => {
          const degree = graph.degree(node);
          graph.setNodeAttribute(node, "size", MINI_GRAPH_NODE_SIZE + Math.sqrt(degree) * MINI_GRAPH_NODE_DEGREE_SCALE);
        });

        sigma = new Sigma(graph, container, {
          allowInvalidContainer: true,
          renderLabels: false,
          defaultNodeColor: MINI_GRAPH_NODE_COLOR,
        });
        sigma.on("clickNode", ({ node }) => onOpenNote(node));

        layout = new FA2Layout(graph, { settings: inferSettings(graph) });
        layout.start();
        stopTimer = setTimeout(() => layout?.stop(), Math.min(3000, 1200 + graph.order * 2));

        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      if (stopTimer) clearTimeout(stopTimer);
      layout?.kill();
      sigma?.kill();
    };
  }, [refreshKey, onOpenNote]);

  return (
    <div className="mini-graph">
      {status === "empty" && (
        <p className="widget-empty muted">
          No links yet — connect notes with <code>[[links]]</code>.
        </p>
      )}
      {status === "error" && <p className="widget-empty muted">Couldn't load the graph.</p>}
      <div
        ref={containerRef}
        className="mini-graph-canvas"
        style={{ visibility: status === "ready" ? "visible" : "hidden" }}
      />
      {status === "ready" && (
        <button className="mini-graph-open" onClick={() => setView("graph")}>
          Open full graph →
        </button>
      )}
    </div>
  );
}
