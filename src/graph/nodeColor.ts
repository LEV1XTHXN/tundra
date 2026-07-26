/**
 * Node color palette + assignment helpers for the graph view's "color by"
 * modes (folder / tag / cluster). Reuses the app's existing TAG_PALETTE
 * (same swatches already seen on tag/property chips and Kanban cards) rather
 * than inventing a second palette, and is theme-invariant by design — like
 * every other TAG_PALETTE consumer, the same hex reads fine in both themes;
 * it's the SURROUNDING chrome (canvas background, edges, the dimmed/neutral
 * tones below) that needs a light/dark variant, not the palette itself.
 */
import { TAG_PALETTE } from "@/store/tagColors";

export type GraphColorMode = "folder" | "tag" | "cluster";

/** Untagged notes in "by tag" mode, and the hovered-fade tone — a muted
 *  neutral gray close to the theme's own --muted-foreground at each theme's
 *  lightness (canvas fillStyle needs a resolved color, not a CSS var). */
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
