/**
 * Graph info & settings panel (Alt+I in the graph view). Pure presentation: it
 * shows derived stats and drives the live display settings via callbacks that
 * `GraphView` wires straight to the sigma/graph/layout instances. No data or IPC
 * here.
 */
import { X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { GraphColorMode } from "./nodeColor";
import type { NodeStyle } from "./GraphView";

export interface GraphStats {
  /** Total notes (nodes). */
  nodes: number;
  /** Resolved links (edges). */
  links: number;
  /** Notes with no links in or out. */
  leaves: number;
}

const COLOR_MODE_OPTIONS: { id: GraphColorMode; label: string }[] = [
  { id: "folder", label: "Folder" },
  { id: "tag", label: "Tag" },
  { id: "cluster", label: "Cluster" },
];

/** Node-style presets — "glossy" is the default; more (e.g. "glow") can be
 *  added here later alongside a matching `nodeProgramClasses` entry in
 *  `GraphView.tsx`. */
const NODE_STYLE_OPTIONS: { id: NodeStyle; label: string }[] = [
  { id: "glossy", label: "Glossy sphere" },
  { id: "flat", label: "Flat" },
];

interface GraphInfoPanelProps {
  stats: GraphStats;
  showLabels: boolean;
  nodeSizeScale: number;
  edgeLength: number;
  colorMode: GraphColorMode;
  sizeByDegree: boolean;
  nodeStyle: NodeStyle;
  onToggleLabels: (next: boolean) => void;
  onNodeSize: (scale: number) => void;
  onEdgeLength: (length: number) => void;
  onColorMode: (mode: GraphColorMode) => void;
  onSizeByDegree: (next: boolean) => void;
  onNodeStyle: (style: NodeStyle) => void;
  onClose: () => void;
}

export function GraphInfoPanel({
  stats,
  showLabels,
  nodeSizeScale,
  edgeLength,
  colorMode,
  sizeByDegree,
  nodeStyle,
  onToggleLabels,
  onNodeSize,
  onEdgeLength,
  onColorMode,
  onSizeByDegree,
  onNodeStyle,
  onClose,
}: GraphInfoPanelProps) {
  return (
    <aside className="graph-panel" aria-label="Graph info and settings">
      <div className="graph-panel-header">
        <span className="graph-panel-title">Graph</span>
        <button className="graph-panel-close" onClick={onClose} title="Close (Alt+I)" aria-label="Close panel">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="graph-panel-section graph-panel-stats">
        <div className="graph-stat">
          <span className="graph-stat-value">{stats.nodes}</span>
          <span className="graph-stat-label muted">Notes</span>
        </div>
        <div className="graph-stat">
          <span className="graph-stat-value">{stats.links}</span>
          <span className="graph-stat-label muted">Links</span>
        </div>
        <div className="graph-stat">
          <span className="graph-stat-value">{stats.leaves}</span>
          <span className="graph-stat-label muted">Leaves</span>
        </div>
      </div>

      <div className="graph-panel-section graph-panel-settings">
        <label className="graph-setting graph-setting-row">
          <span>Node style</span>
          <Select value={nodeStyle} onValueChange={(v) => onNodeStyle(v as NodeStyle)}>
            <SelectTrigger className="graph-setting-select" size="sm" aria-label="Node style">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NODE_STYLE_OPTIONS.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="graph-setting graph-setting-row">
          <span>Color by</span>
          <Select value={colorMode} onValueChange={(v) => onColorMode(v as GraphColorMode)}>
            <SelectTrigger className="graph-setting-select" size="sm" aria-label="Color nodes by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLOR_MODE_OPTIONS.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="graph-setting graph-setting-row">
          <span>Show names</span>
          <input
            type="checkbox"
            checked={showLabels}
            onChange={(e) => onToggleLabels(e.target.checked)}
          />
        </label>

        <label className="graph-setting graph-setting-row">
          <span>Size by connections</span>
          <input
            type="checkbox"
            checked={sizeByDegree}
            onChange={(e) => onSizeByDegree(e.target.checked)}
          />
        </label>

        <label className="graph-setting">
          <span className="graph-setting-head">
            Node size <span className="muted">{nodeSizeScale.toFixed(1)}×</span>
          </span>
          <input
            type="range"
            min={0.3}
            max={3}
            step={0.1}
            value={nodeSizeScale}
            onChange={(e) => onNodeSize(Number(e.target.value))}
          />
        </label>

        <label className="graph-setting">
          <span className="graph-setting-head">
            Line length <span className="muted">{edgeLength.toFixed(1)}×</span>
          </span>
          <input
            type="range"
            min={0.3}
            max={3}
            step={0.1}
            value={edgeLength}
            onChange={(e) => onEdgeLength(Number(e.target.value))}
          />
        </label>
      </div>
    </aside>
  );
}
