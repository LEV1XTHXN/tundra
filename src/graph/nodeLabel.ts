/**
 * Custom node-label renderers that place the note title centered directly BELOW
 * the node, rather than sigma's default position to the upper-right. Both the
 * normal and hover states use the same placement so the label doesn't jump when
 * you point at a node.
 *
 * The function types are derived from sigma's own constructor settings so they
 * stay in lockstep with the library without importing its subpath type modules.
 */
import type Sigma from "sigma";

type SigmaSettings = NonNullable<ConstructorParameters<typeof Sigma>[2]>;
type NodeLabelFn = NonNullable<SigmaSettings["defaultDrawNodeLabel"]>;
type NodeHoverFn = NonNullable<SigmaSettings["defaultDrawNodeHover"]>;
type NodeLabelData = Parameters<NodeLabelFn>[1];
type LabelSettings = Parameters<NodeLabelFn>[2];

/** Resolve the label colour the same way sigma's default drawer does. */
function labelColor(data: NodeLabelData, settings: LabelSettings): string {
  const { labelColor: c } = settings;
  if (c.attribute) {
    return ((data as Record<string, unknown>)[c.attribute] as string) || c.color || "#000";
  }
  return c.color || "#000";
}

/** Gap (px) between the bottom of the node and the top of its label. */
const LABEL_GAP = 2;

/** Baseline y for a label centered under a node of the given drawn size. */
function labelBaselineY(data: NodeLabelData, size: number): number {
  return data.y + data.size + LABEL_GAP + size;
}

export const drawNodeLabelBelow: NodeLabelFn = (context, data, settings) => {
  if (!data.label) return;
  const size = settings.labelSize;
  context.fillStyle = labelColor(data, settings);
  context.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
  context.textAlign = "center";
  context.fillText(data.label, data.x, labelBaselineY(data, size));
  // Restore the default alignment — edge labels center themselves manually and
  // assume the canvas is left-aligned.
  context.textAlign = "left";
};

export const drawNodeHoverBelow: NodeHoverFn = (context, data, settings) => {
  if (!data.label) return;
  const size = settings.labelSize;
  context.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;

  // A soft rounded background box centered under the node, sized to the text.
  const textWidth = context.measureText(data.label).width;
  const boxW = Math.round(textWidth + 8);
  const boxH = Math.round(size + 6);
  const top = data.y + data.size + LABEL_GAP;
  const left = data.x - boxW / 2;
  const r = 3;

  context.fillStyle = "#fff";
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
  context.shadowBlur = 8;
  context.shadowColor = "rgba(0, 0, 0, 0.18)";
  context.beginPath();
  context.moveTo(left + r, top);
  context.arcTo(left + boxW, top, left + boxW, top + boxH, r);
  context.arcTo(left + boxW, top + boxH, left, top + boxH, r);
  context.arcTo(left, top + boxH, left, top, r);
  context.arcTo(left, top, left + boxW, top, r);
  context.closePath();
  context.fill();
  context.shadowBlur = 0;

  context.fillStyle = labelColor(data, settings);
  context.textAlign = "center";
  context.fillText(data.label, data.x, top + size);
  context.textAlign = "left";
};
