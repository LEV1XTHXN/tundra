import type { CSSProperties } from "react";
import { create } from "zustand";

import { config, kanban, tags as tagsService } from "@/services";
import type { KanbanBoard } from "@/services";

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

/**
 * Inline style for a *Kanban* tag chip — deliberately distinct from a plain tag
 * (`tagChipStyle`). Same color choice; different treatment. Instead of a solid
 * fill, a Kanban tag reads as an "outline" chip: a pastel wash of its color
 * inside, a full-strength border in that same color, and text tinted toward the
 * theme foreground so it stays legible in light *and* dark. This makes
 * Kanban-managed tags feel exclusive at a glance, wherever they render.
 */
export function kanbanTagChipStyle(color?: string): CSSProperties {
  if (!color) {
    // A colorless Kanban tag still gets the outline treatment (neutral border),
    // so it never looks like a plain tag.
    return {
      backgroundColor: "color-mix(in srgb, var(--foreground) 6%, transparent)",
      borderColor: "var(--muted-foreground)",
      color: "var(--foreground)",
    };
  }
  return {
    backgroundColor: `color-mix(in srgb, ${color} 16%, var(--background))`,
    borderColor: color,
    color: `color-mix(in srgb, ${color} 70%, var(--foreground))`,
  };
}

/**
 * The set of tags currently owned by a Kanban column, across *every* board. A
 * tag is "a Kanban tag" globally (not per-board), so any chip — on a card or in
 * the inspector — can tell a Kanban-managed tag from a plain one and pick
 * `kanbanTagChipStyle`. Reloaded on vault open (App) and kept live by the
 * Kanban view (which holds the authoritative board list).
 */
interface KanbanTagsState {
  tags: Set<string>;
  /** Reload the set from the vault's boards (call after a vault opens). */
  load: () => Promise<void>;
  /** Recompute the set from an already-fetched board list (Kanban view). */
  setFromBoards: (boards: KanbanBoard[]) => void;
}

function collectColumnTags(boards: KanbanBoard[]): Set<string> {
  const tags = new Set<string>();
  for (const board of boards) {
    for (const column of board.columns) {
      if (column.tag) tags.add(column.tag);
    }
  }
  return tags;
}

export const useKanbanTags = create<KanbanTagsState>((set) => ({
  tags: new Set(),
  load: async () => {
    set({ tags: collectColumnTags(await kanban.boards()) });
  },
  setFromBoards: (boards) => set({ tags: collectColumnTags(boards) }),
}));

/**
 * Every distinct tag currently used anywhere in the vault (sorted), owned by the
 * core (`tags.list`). This is the live pool the tag suggestions and the settings
 * tag manager read from — reloaded on vault open (App) and after any tag mutation
 * (add/rename/delete) so a freshly-created tag becomes suggestable at once. Unlike
 * `useTagColors`, it tracks *all* tags, not just the colored ones.
 */
interface VaultTagsState {
  tags: string[];
  /** Reload the full tag list from the open vault. */
  load: () => Promise<void>;
}

export const useVaultTags = create<VaultTagsState>((set) => ({
  tags: [],
  load: async () => {
    set({ tags: await tagsService.list() });
  },
}));
