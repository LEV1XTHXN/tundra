/**
 * Node color palette + assignment helpers for the graph view's "color by"
 * modes (folder / tag / cluster — `GraphView.tsx`). Reuses the app's
 * existing `TAG_PALETTE` (the same swatches already on tag/property chips
 * and Kanban cards) rather than inventing a second palette. The palette
 * itself is deliberately theme-invariant, matching every other TAG_PALETTE
 * consumer (`tagChipStyle` doesn't branch on theme either) — it's the
 * surrounding chrome (canvas background, edges, dim/neutral tones) that
 * needs a light/dark variant, not the swatches.
 */
import { TAG_PALETTE } from "@/store/tagColors";

export type GraphColorMode = "folder" | "tag" | "cluster";

/** Untagged notes in "by tag" mode — a muted neutral, not part of the
 *  palette proper (canvas fillStyle needs a resolved color, not a CSS var,
 *  so these approximate the theme's own --muted-foreground at each theme's
 *  lightness rather than referencing it directly). */
export const NEUTRAL_LIGHT = "#a1a1aa";
export const NEUTRAL_DARK = "#71717a";

/** The hover-dim tone for nodes outside the hovered node's neighborhood. */
export const DIM_LIGHT = "#d4d4d8";
export const DIM_DARK = "#3f3f46";

function paletteColor(index: number): string {
  const n = TAG_PALETTE.length;
  return TAG_PALETTE[((index % n) + n) % n];
}

/**
 * Builds a stable value → palette-color function over a known, finite set of
 * distinct values (every folder path, or every primary tag, present in the
 * graph at build time). Sorted so the assignment is stable across reloads —
 * not just within one session — rather than depending on iteration/insertion
 * order, which would drift as notes are added or removed between opens.
 */
export function paletteAssigner(values: Iterable<string>): (value: string) => string {
  const sorted = Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  const index = new Map(sorted.map((v, i) => [v, i]));
  return (value: string) => paletteColor(index.get(value) ?? 0);
}

/** Louvain community ids are small sequential integers — index the palette
 *  directly, no assigner/sorting needed. */
export function clusterColor(id: number): string {
  return paletteColor(id);
}
