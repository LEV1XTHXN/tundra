import { create } from "zustand";

import { config, type Icon, type PropertyType } from "@/services";

export type { PropertyType };

/**
 * Per-folder view configuration (note sorting + the folder "database" table).
 *
 * This is presentation config, not note content, so — like tag colors and the
 * graph view — it lives in `.vault/config/folder-views.json` via the existing
 * vault-config passthrough (no new Rust command). It is keyed by the folder's
 * `/`-separated path relative to the notes root (`""` = the vault root).
 *
 * Design decisions (locked with the user):
 * - **Folder-specific schema.** Each folder owns its own property definitions +
 *   columns; a Recipes folder and a Work folder don't share columns. A note's
 *   *values* live on the note (mirrored into `NoteSummary.properties`); the
 *   *definitions* live here.
 * - **Independent sort.** The sidebar tree (`treeSort`) and the folder's table
 *   (`tableSort`) each keep their own order — they can disagree.
 * - **Uniform at every nesting level.** Every folder path gets its own entry.
 */
const CONFIG_NAME = "folder-views";

/** One choice in a `select` / `multiSelect` property (id is stable; name/color editable). */
export interface SelectOption {
  id: string;
  name: string;
  /** Hex color from `TAG_PALETTE` (reused so the whole app shares one palette). */
  color: string;
}

/** A folder-scoped property definition — the column schema for the table view. */
export interface PropertyDef {
  id: string;
  name: string;
  type: PropertyType;
  /** Present only for `select` / `multiSelect`. */
  options?: SelectOption[];
}

export type SortDir = "asc" | "desc";

/** Sidebar-tree ordering for a folder's direct children. `manual` = user drag order. */
export type TreeSortField = "manual" | "name" | "modified" | "created" | "size";
export interface TreeSort {
  by: TreeSortField;
  dir: SortDir;
}

/** A built-in note-metadata column the table can show/sort by (no schema needed). */
export type BuiltinColumn = "modified" | "created" | "size";

/**
 * A folder-table column *other than* the always-present Name column: either a
 * built-in metadata field or a user-defined property (by id). Strings keep the
 * built-ins compact in JSON; `{ prop }` names a custom property.
 */
export type ColumnKey = BuiltinColumn | { prop: string };

/** A table sort key — the Name column, or any {@link ColumnKey}. */
export type TableSortKey = "name" | ColumnKey;
export interface TableSort {
  key: TableSortKey;
  dir: SortDir;
}

/** True when two column/sort keys refer to the same column. */
export function sameColumnKey(a: TableSortKey, b: TableSortKey): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.prop === b.prop;
}

/** The persisted view config for a single folder. All fields optional (defaults applied on read). */
export interface FolderView {
  /** This folder's icon (emoji or custom image), shown in the sidebar tree.
   *  Folders have no note-meta file, so — like sort order — the icon lives here. */
  icon?: Icon;
  /** Sidebar tree order for this folder's children. Defaults to `{ by: "manual" }`. */
  treeSort?: TreeSort;
  /**
   * Explicit child order for `treeSort.by === "manual"`. Entries are
   * `note:<id>` or `folder:<name>`; anything not listed sorts to the bottom
   * (new items append). Built via {@link noteKey} / {@link folderKey}.
   */
  manualOrder?: string[];
  /** This folder's property definitions (the custom part of the table schema). */
  properties?: PropertyDef[];
  /** Columns shown in the table (besides Name), in display order — built-ins or properties. */
  columns?: ColumnKey[];
  /** Multi-level table sort (first entry = primary). */
  tableSort?: TableSort[];
  /** User-set column widths in px, keyed by column key string (`"name"`, `"modified"`,
   *  `"prop:<id>"` — see `columnKeyStr`). Absent columns use a per-type default. */
  columnWidths?: Record<string, number>;
}

export type FolderViews = Record<string, FolderView>;

/** Manual-order / drag key for a note. */
export const noteKey = (id: string) => `note:${id}`;
/** Manual-order / drag key for a subfolder (identified by name within its parent). */
export const folderKey = (name: string) => `folder:${name}`;

interface FolderViewsState {
  views: FolderViews;
  loaded: boolean;
  /** Load the map for the currently open vault (call after a vault opens). */
  load: () => Promise<void>;
  /** The stored view for `path`, or an empty view (never `undefined`). */
  get: (path: string) => FolderView;
  /** Shallow-merge `partial` into a folder's view and persist. Pass a fresh
   *  `properties`/`columns`/`manualOrder` array to replace (no deep merge). */
  patch: (path: string, partial: FolderView) => Promise<void>;
}

const EMPTY: FolderView = {};

export const useFolderViews = create<FolderViewsState>((set, get) => ({
  views: {},
  loaded: false,
  load: async () => {
    const map = (await config.read<FolderViews>(CONFIG_NAME)) ?? {};
    set({ views: map, loaded: true });
  },
  get: (path) => get().views[path] ?? EMPTY,
  patch: async (path, partial) => {
    const current = get().views[path] ?? EMPTY;
    const nextView = { ...current, ...partial };
    const next = { ...get().views, [path]: nextView };
    set({ views: next });
    await config.write(CONFIG_NAME, next);
  },
}));
