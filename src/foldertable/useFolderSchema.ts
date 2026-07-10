import { useCallback, useMemo } from "react";

import { TAG_PALETTE } from "@/store/tagColors";
import {
  sameColumnKey,
  useFolderViews,
  type BuiltinColumn,
  type ColumnKey,
  type PropertyDef,
  type PropertyType,
  type SelectOption,
  type SortDir,
  type TableSort,
  type TableSortKey,
} from "@/store/folderViews";

/** Stable id for a new property/option. `crypto.randomUUID` is available in the webview. */
const newId = () => crypto.randomUUID();

/**
 * Folder-table schema (columns + property definitions + table sort) bound to one
 * folder's entry in the `folderViews` store. Centralizes the tricky invariants —
 * removing a column also drops it from the sort; deleting a property removes its
 * column too — so the components stay declarative. A note's property *values*
 * live on the note (see `notes.setProperty`); this only touches the folder's
 * schema/view config.
 */
export function useFolderSchema(path: string) {
  const view = useFolderViews((s) => s.views[path]);
  const patch = useFolderViews((s) => s.patch);

  const properties = useMemo(() => view?.properties ?? [], [view]);
  const columns = useMemo(() => view?.columns ?? [], [view]);
  const tableSort = useMemo(() => view?.tableSort ?? [], [view]);
  const columnWidths = useMemo(() => view?.columnWidths ?? {}, [view]);
  const propsById = useMemo(
    () => Object.fromEntries(properties.map((p) => [p.id, p])) as Record<string, PropertyDef>,
    [properties],
  );

  const addBuiltinColumn = useCallback(
    (b: BuiltinColumn) => {
      if (columns.some((c) => sameColumnKey(c, b))) return;
      void patch(path, { columns: [...columns, b] });
    },
    [columns, patch, path],
  );

  const createProperty = useCallback(
    (name: string, type: PropertyType): PropertyDef => {
      const def: PropertyDef = {
        id: newId(),
        name: name.trim() || "Property",
        type,
        ...(type === "select" || type === "multiSelect" ? { options: [] } : {}),
      };
      void patch(path, { properties: [...properties, def], columns: [...columns, { prop: def.id }] });
      return def;
    },
    [columns, patch, path, properties],
  );

  const updateProperty = useCallback(
    (id: string, changes: Partial<PropertyDef>) => {
      void patch(path, { properties: properties.map((p) => (p.id === id ? { ...p, ...changes } : p)) });
    },
    [patch, path, properties],
  );

  /** Append a new option to a select/multiSelect property, returning it (next palette color). */
  const addOption = useCallback(
    (propId: string, name: string): SelectOption => {
      const def = propsById[propId];
      const existing = def?.options ?? [];
      const option: SelectOption = {
        id: newId(),
        name: name.trim(),
        color: TAG_PALETTE[existing.length % TAG_PALETTE.length],
      };
      void patch(path, {
        properties: properties.map((p) => (p.id === propId ? { ...p, options: [...existing, option] } : p)),
      });
      return option;
    },
    [patch, path, properties, propsById],
  );

  const removeColumn = useCallback(
    (key: ColumnKey) => {
      void patch(path, {
        columns: columns.filter((c) => !sameColumnKey(c, key)),
        tableSort: tableSort.filter((s) => !sameColumnKey(s.key, key)),
      });
    },
    [columns, patch, path, tableSort],
  );

  /** Delete a custom property entirely: its column, sort entry, and definition. */
  const removeProperty = useCallback(
    (id: string) => {
      void patch(path, {
        properties: properties.filter((p) => p.id !== id),
        columns: columns.filter((c) => !(typeof c === "object" && c.prop === id)),
        tableSort: tableSort.filter((s) => !(typeof s.key === "object" && s.key.prop === id)),
      });
    },
    [columns, patch, path, properties, tableSort],
  );

  /** Replace the whole sort spec (used by the multi-level sort panel). */
  const setSort = useCallback(
    (sorts: TableSort[]) => {
      void patch(path, { tableSort: sorts });
    },
    [patch, path],
  );

  /**
   * Set `key`'s direction. If it's already one of the sort levels, change that
   * level in place (preserving a multi-level sort); otherwise sort by `key`
   * alone. Used by the header's explicit "Sort ascending/descending".
   */
  const sortBy = useCallback(
    (key: TableSortKey, dir: SortDir) => {
      const idx = tableSort.findIndex((s) => sameColumnKey(s.key, key));
      if (idx >= 0) setSort(tableSort.map((s, i) => (i === idx ? { key, dir } : s)));
      else setSort([{ key, dir }]);
    },
    [setSort, tableSort],
  );

  /**
   * Header click: flip `key`'s direction if it's already in the sort (keeping any
   * other levels), else sort by `key` ascending alone.
   */
  const toggleSort = useCallback(
    (key: TableSortKey) => {
      const existing = tableSort.find((s) => sameColumnKey(s.key, key));
      sortBy(key, existing && existing.dir === "asc" ? "desc" : "asc");
    },
    [sortBy, tableSort],
  );

  /** Persist a resized column width (px), keyed by its column key string. */
  const setColumnWidth = useCallback(
    (keyStr: string, px: number) => {
      void patch(path, { columnWidths: { ...columnWidths, [keyStr]: Math.round(px) } });
    },
    [columnWidths, patch, path],
  );

  const currentSort = tableSort[0];

  return {
    properties,
    columns,
    tableSort,
    columnWidths,
    propsById,
    currentSort,
    setColumnWidth,
    addBuiltinColumn,
    createProperty,
    updateProperty,
    addOption,
    removeColumn,
    removeProperty,
    setSort,
    sortBy,
    toggleSort,
  };
}
