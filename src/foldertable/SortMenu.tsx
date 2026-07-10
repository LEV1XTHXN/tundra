import { useState } from "react";
import { ArrowUpDown, ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { type TableSort, type TableSortKey } from "@/store/folderViews";
import { columnKeyStr, columnLabel } from "./ordering";
import type { useFolderSchema } from "./useFolderSchema";

type Schema = ReturnType<typeof useFolderSchema>;

interface SortMenuProps {
  schema: Schema;
}

/**
 * Multi-level sort panel: stack several sort criteria at once (e.g. Last modified
 * ascending, then a custom property descending). The first level is primary; ties
 * fall through to the next. Each level can flip direction, move up/down, or be
 * removed; "Add sort" appends the next unused column.
 */
export function SortMenu({ schema }: SortMenuProps) {
  const { tableSort, columns, propsById, setSort } = schema;
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  const allKeys: TableSortKey[] = ["name", ...columns];
  const usedStr = new Set(tableSort.map((s) => columnKeyStr(s.key)));
  const available = allKeys.filter((k) => !usedStr.has(columnKeyStr(k)));

  const flipDir = (i: number) =>
    setSort(tableSort.map((s, idx) => (idx === i ? { ...s, dir: s.dir === "asc" ? "desc" : "asc" } : s)));
  const remove = (i: number) => setSort(tableSort.filter((_, idx) => idx !== i));
  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= tableSort.length) return;
    const next = [...tableSort];
    [next[i], next[j]] = [next[j], next[i]];
    setSort(next);
  };
  const add = (key: TableSortKey) => {
    setSort([...tableSort, { key, dir: "asc" } as TableSort]);
    setAdding(false);
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setAdding(false); }}>
      <PopoverTrigger asChild>
        <button className={cn("ft-toolbar-button", tableSort.length > 0 && "active")} title="Sort">
          <ArrowUpDown size={14} />
          Sort{tableSort.length > 0 ? ` (${tableSort.length})` : ""}
        </button>
      </PopoverTrigger>
      <PopoverContent className="ft-sort-panel" align="end">
        {tableSort.length === 0 && <div className="ft-sort-empty muted">No sorts applied.</div>}

        {tableSort.map((sort, i) => (
          <div key={columnKeyStr(sort.key)} className="ft-sort-level">
            <span className="ft-sort-name">{columnLabel(sort.key, propsById)}</span>
            <button className="ft-sort-dir" onClick={() => flipDir(i)}>
              {sort.dir === "asc" ? "Ascending" : "Descending"}
            </button>
            <div className="ft-sort-move">
              <button disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                <ChevronUp size={13} />
              </button>
              <button disabled={i === tableSort.length - 1} onClick={() => move(i, 1)} title="Move down">
                <ChevronDown size={13} />
              </button>
            </div>
            <button className="ft-sort-remove" onClick={() => remove(i)} title="Remove">
              <X size={13} />
            </button>
          </div>
        ))}

        {available.length > 0 &&
          (adding ? (
            <div className="ft-sort-add-list">
              {available.map((k) => (
                <button key={columnKeyStr(k)} className="ft-menu-item" onClick={() => add(k)}>
                  {columnLabel(k, propsById)}
                </button>
              ))}
            </div>
          ) : (
            <button className="ft-sort-add" onClick={() => setAdding(true)}>
              <Plus size={13} /> Add sort
            </button>
          ))}
      </PopoverContent>
    </Popover>
  );
}
