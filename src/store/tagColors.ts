import type { CSSProperties } from "react";
import { create } from "zustand";

import { config } from "@/services";

/**
 * Per-vault tag → color map (Phase 3+). Tag colors are presentation config, not
 * note content, so they live in `.vault/config/tag-colors.json` via the existing
 * vault-config passthrough (same class as graph-view.json / home.json) — no new
 * Rust command needed. Colors are keyed by the tag *string*, so a color is shared
 * everywhere that tag appears (Kanban cards, column dots, the note inspector).
 */
const CONFIG_NAME = "tag-colors";

/** A small fixed palette of readable swatches offered by the color pickers. */
export const TAG_PALETTE = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // amber
  "#22c55e", // green
  "#14b8a6", // teal
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
] as const;

interface TagColorsState {
  /** tag → hex color. A tag absent from the map has no assigned color. */
  colors: Record<string, string>;
  loaded: boolean;
  /** Load the map for the currently open vault (call after a vault opens). */
  load: () => Promise<void>;
  /** Set (or clear, with `null`) a tag's color and persist to vault config. */
  setColor: (tag: string, color: string | null) => Promise<void>;
}

export const useTagColors = create<TagColorsState>((set, get) => ({
  colors: {},
  loaded: false,
  load: async () => {
    const map = (await config.read<Record<string, string>>(CONFIG_NAME)) ?? {};
    set({ colors: map, loaded: true });
  },
  setColor: async (tag, color) => {
    const next = { ...get().colors };
    if (color) next[tag] = color;
    else delete next[tag];
    set({ colors: next });
    await config.write(CONFIG_NAME, next);
  },
}));

/** Black or white text for a hex background, by perceived luminance. */
export function contrastText(hex: string): string {
  const c = hex.replace("#", "");
  if (c.length < 6) return "#fff";
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#111111" : "#ffffff";
}

/** Inline style for a tag chip: solid fill in the tag's color, or `{}` if none. */
export function tagChipStyle(color?: string): CSSProperties {
  if (!color) return {};
  return { backgroundColor: color, borderColor: color, color: contrastText(color) };
}
