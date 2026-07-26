/**
 * Graph info & settings panel (Alt+I in the graph view). Pure presentation: it
 * shows derived stats and drives the live display settings via callbacks that
 * `GraphView` wires straight to the sigma/graph/layout instances. No data or IPC
 * here.
 */
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { GraphColorMode } from "./nodeColor";

export interface GraphStats {
  /** Total notes (nodes). */
  nodes: number;
  /** Resolved links (edges). */
  links: number;
  /** Notes with no links in or out. */
  leaves: number;
}

const COLOR_MODE_OPTIONS: { id: GraphColorMode; labelKey: string }[] = [
  { id: "folder", labelKey: "graph.colorByFolder" },
  { id: "tag", labelKey: "graph.colorByTag" },
  { id: "cluster", labelKey: "graph.colorByCluster" },
];

interface GraphInfoPanelProps {
  stats: GraphStats;
  showLabels: boolean;
  nodeSizeScale: number;
  edgeLength: number;
  colorMode: GraphColorMode;
  sizeByDegree: boolean;
  onToggleLabels: (next: boolean) => void;
  onNodeSize: (scale: number) => void;
  onEdgeLength: (length: number) => void;
  onColorMode: (mode: GraphColorMode) => void;
  onSizeByDegree: (next: boolean) => void;
  onClose: () => void;
}

export function GraphInfoPanel({
  stats,
  showLabels,
  nodeSizeScale,
  edgeLength,
  colorMode,
  sizeByDegree,
  onToggleLabels,
  onNodeSize,
  onEdgeLength,
  onColorMode,
  onSizeByDegree,
  onClose,
}: GraphInfoPanelProps) {
  const { t } = useTranslation();
  return (
    <aside className="graph-panel" aria-label="Graph info and settings">
      <div className="graph-panel-header">
        <span className="graph-panel-title">{t("graph.title")}</span>
        <button className="graph-panel-close" onClick={onClose} title={t("graph.closePanel")} aria-label={t("common.close")}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="graph-panel-section graph-panel-stats">
        <div className="graph-stat">
          <span className="graph-stat-value">{stats.nodes}</span>
          <span className="graph-stat-label muted">{t("graph.notes")}</span>
        </div>
        <div className="graph-stat">
          <span className="graph-stat-value">{stats.links}</span>
          <span className="graph-stat-label muted">{t("graph.links")}</span>
        </div>
        <div className="graph-stat">
          <span className="graph-stat-value">{stats.leaves}</span>
          <span className="graph-stat-label muted">{t("graph.leaves")}</span>
        </div>
      </div>

      <div className="graph-panel-section graph-panel-settings">
        <label className="graph-setting graph-setting-row">
          <span>{t("graph.colorBy")}</span>
          <Select value={colorMode} onValueChange={(v) => onColorMode(v as GraphColorMode)}>
            <SelectTrigger className="graph-setting-select" size="sm" aria-label={t("graph.colorBy")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLOR_MODE_OPTIONS.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {t(o.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="graph-setting graph-setting-row">
          <span>{t("graph.showNames")}</span>
          <input
            type="checkbox"
            checked={showLabels}
            onChange={(e) => onToggleLabels(e.target.checked)}
          />
        </label>

        <label className="graph-setting graph-setting-row">
          <span>{t("graph.sizeByConnections")}</span>
          <input
            type="checkbox"
            checked={sizeByDegree}
            onChange={(e) => onSizeByDegree(e.target.checked)}
          />
        </label>

        <label className="graph-setting">
          <span className="graph-setting-head">
            {t("graph.nodeSize")} <span className="muted">{nodeSizeScale.toFixed(1)}×</span>
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
            {t("graph.lineLength")} <span className="muted">{edgeLength.toFixed(1)}×</span>
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
