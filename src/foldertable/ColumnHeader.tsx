import { useState } from "react";
import { ArrowDown, ArrowUp, EyeOff, Pencil, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { sameColumnKey, type ColumnKey, type PropertyDef } from "@/store/folderViews";
import { columnLabel } from "./ordering";
import { PropertyEditor } from "./PropertyEditor";
import type { useFolderSchema } from "./useFolderSchema";

type Schema = ReturnType<typeof useFolderSchema>;

interface ColumnHeaderProps {
  columnKey: ColumnKey;
  schema: Schema;
  /** Fixed width in px (kept in lock-step with the body cells). */
  width: number;
  /** Begin a drag-resize from the column's right edge. */
  onResizeStart: (e: React.MouseEvent) => void;
}

/**
 * A table column header: click to sort (toggling direction), or open the caret
 * menu to hide the column or — for a custom property — edit or delete it. The
 * Name column is rendered separately (it's fixed and always present).
 */
export function ColumnHeader({ columnKey, schema, width, onResizeStart }: ColumnHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const { propsById, tableSort, toggleSort, sortBy, removeColumn, removeProperty } = schema;
  const label = columnLabel(columnKey, propsById);
  // Reflect this column's sort at ANY level (multi-level sort), plus its rank.
  const sortIndex = tableSort.findIndex((s) => sameColumnKey(s.key, columnKey));
  const mySort = sortIndex >= 0 ? tableSort[sortIndex] : undefined;
  const def: PropertyDef | undefined = typeof columnKey === "object" ? propsById[columnKey.prop] : undefined;

  return (
    <div className="ft-th" style={{ flex: `0 0 ${width}px`, width, minWidth: width }}>
      <button className="ft-th-label" onClick={() => toggleSort(columnKey)}>
        <span>{label}</span>
        {mySort && (mySort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
        {mySort && tableSort.length > 1 && <span className="ft-sort-rank">{sortIndex + 1}</span>}
      </button>

      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button className="ft-th-caret" title="Column options">⋯</button>
        </PopoverTrigger>
        <PopoverContent className="ft-col-menu" align="end">
          <button className="ft-menu-item" onClick={() => { sortBy(columnKey, "asc"); setMenuOpen(false); }}>
            <ArrowUp size={13} /> Sort ascending
          </button>
          <button className="ft-menu-item" onClick={() => { sortBy(columnKey, "desc"); setMenuOpen(false); }}>
            <ArrowDown size={13} /> Sort descending
          </button>
          {def && (
            <button className="ft-menu-item" onClick={() => { setEditing(true); setMenuOpen(false); }}>
              <Pencil size={13} /> Edit property
            </button>
          )}
          <button className="ft-menu-item" onClick={() => { removeColumn(columnKey); setMenuOpen(false); }}>
            <EyeOff size={13} /> Hide column
          </button>
          {def && (
            <button
              className="ft-menu-item ft-menu-danger"
              onClick={() => { removeProperty(def.id); setMenuOpen(false); }}
            >
              <Trash2 size={13} /> Delete property
            </button>
          )}
        </PopoverContent>
      </Popover>

      <div className="ft-col-resize" onMouseDown={onResizeStart} title="Drag to resize" />

      {def && editing && (
        <PropertyEditor def={def} schema={schema} open={editing} onOpenChange={setEditing} />
      )}
    </div>
  );
}
