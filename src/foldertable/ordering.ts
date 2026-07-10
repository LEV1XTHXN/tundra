import type { NoteSummary, PropertyValue } from "@/services";
import type { ColumnKey, PropertyDef, TableSort, TableSortKey } from "@/store/folderViews";

/** Human label for a column (Name plus built-ins and custom properties). */
export function columnLabel(key: TableSortKey, propsById: Record<string, PropertyDef>): string {
  if (key === "name") return "Name";
  if (key === "modified") return "Last modified";
  if (key === "created") return "Created";
  if (key === "size") return "Size";
  return propsById[key.prop]?.name ?? "Property";
}

/** A stable string key (for React lists / dedupe) for any column or sort key. */
export function columnKeyStr(key: TableSortKey | ColumnKey): string {
  return typeof key === "string" ? key : `prop:${key.prop}`;
}

/** One row in a folder's table: a subfolder (drill-in) or a note. */
export type TableRow =
  | { kind: "folder"; name: string; path: string; pinned: boolean }
  | { kind: "note"; summary: NoteSummary; pinned: boolean };

/** The typed property value stored on a note for `propId`, or `undefined`. */
export function propertyValue(summary: NoteSummary, propId: string): PropertyValue | undefined {
  const raw = summary.properties?.[propId];
  return raw === undefined ? undefined : (raw as PropertyValue);
}

/** Rows sort in three tiers: pinned first, then folders above notes, then the table sort. */
function pinRank(r: TableRow): number {
  return r.pinned ? 0 : 1;
}
function kindRank(r: TableRow): number {
  return r.kind === "folder" ? 0 : 1;
}

const rowName = (r: TableRow) => (r.kind === "folder" ? r.name : r.summary.title || "Untitled");

/** Finite numeric compare that never yields `NaN` (which would corrupt Array.sort). */
function numCompare(a: number, b: number): number {
  const d = a - b;
  return Number.isFinite(d) ? d : 0;
}

/**
 * Does `row` have a value for `key`? Used so empty values sort **last regardless
 * of sort direction** (handled in `orderRows`, outside the asc/desc flip). Name
 * always has a value; built-ins only apply to notes; a property is "present" only
 * when the note actually stores a value for it.
 */
function hasColumnValue(row: TableRow, key: TableSortKey): boolean {
  if (key === "name") return true;
  if (row.kind !== "note") return false;
  if (key === "modified" || key === "created" || key === "size") return true;
  return propertyValue(row.summary, key.prop) !== undefined;
}

/**
 * Ascending compare of two rows by one column, assuming BOTH have a value (the
 * caller has already handled presence). Guaranteed finite. `select` sorts by the
 * option's position in the property definition (so "To do → Doing → Done" order
 * is honored, not alphabetical).
 */
function compareByColumn(a: TableRow, b: TableRow, key: TableSortKey, propsById: Record<string, PropertyDef>): number {
  if (key === "name") {
    return rowName(a).localeCompare(rowName(b), undefined, { sensitivity: "base" });
  }
  // Non-name columns don't apply to folders (presence guard keeps them out).
  if (a.kind !== "note" || b.kind !== "note") return 0;
  const sa = a.summary;
  const sb = b.summary;

  if (key === "modified") return sa.modified.localeCompare(sb.modified);
  if (key === "created") return sa.created.localeCompare(sb.created);
  if (key === "size") return numCompare(sa.size ?? 0, sb.size ?? 0);

  // Custom property column — both present (presence checked by the caller).
  const propId = key.prop;
  const va = propertyValue(sa, propId);
  const vb = propertyValue(sb, propId);
  if (!va || !vb) return 0;

  const def = propsById[propId];
  switch (va.type) {
    case "number":
      return numCompare(Number(va.value), vb.type === "number" ? Number(vb.value) : 0);
    case "date":
      return String(va.value).localeCompare(vb.type === "date" ? String(vb.value) : "");
    case "text":
      return String(va.value).localeCompare(vb.type === "text" ? String(vb.value) : "", undefined, { sensitivity: "base" });
    case "select": {
      const order = def?.options ?? [];
      const ia = order.findIndex((o) => o.id === va.value);
      const ib = vb.type === "select" ? order.findIndex((o) => o.id === vb.value) : -1;
      return numCompare(ia, ib);
    }
    case "multiSelect": {
      const order = def?.options ?? [];
      const first = (v: PropertyValue) =>
        v.type === "multiSelect" && v.value.length > 0 ? order.findIndex((o) => o.id === v.value[0]) : Number.MAX_SAFE_INTEGER;
      return numCompare(first(va), first(vb));
    }
    default:
      return 0;
  }
}

/**
 * Order a folder's table rows. Tiers, in priority: pinned first → folders above
 * notes → each level of the **multi-level** table sort (first entry primary; a
 * level with an empty value on one side sorts that row last regardless of the
 * level's direction) → finally Name as a stable tiebreak (so folders and
 * equal-valued notes stay alphabetical rather than in arbitrary disk order).
 */
export function orderRows(
  rows: TableRow[],
  tableSort: TableSort[],
  propsById: Record<string, PropertyDef>,
): TableRow[] {
  const indexed = rows.map((row, i) => ({ row, i }));
  indexed.sort((x, y) => {
    const p = pinRank(x.row) - pinRank(y.row);
    if (p !== 0) return p;
    const k = kindRank(x.row) - kindRank(y.row);
    if (k !== 0) return k;

    for (const sort of tableSort) {
      const hx = hasColumnValue(x.row, sort.key);
      const hy = hasColumnValue(y.row, sort.key);
      if (hx !== hy) return hx ? -1 : 1; // present before empty, either direction
      if (!hx) continue; // both empty on this level — defer to the next level
      const c = compareByColumn(x.row, y.row, sort.key, propsById) * (sort.dir === "desc" ? -1 : 1);
      if (c !== 0) return c;
    }

    const byName = rowName(x.row).localeCompare(rowName(y.row), undefined, { sensitivity: "base" });
    return byName !== 0 ? byName : x.i - y.i;
  });
  return indexed.map((e) => e.row);
}
