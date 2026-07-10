import { ArrowDownAZ, ArrowUpAZ, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  useFolderViews,
  type SortDir,
  type TreeSort,
  type TreeSortField,
} from "@/store/folderViews";

/** The sidebar-tree sort fields, in menu order, with human labels. */
const FIELDS: { field: TreeSortField; label: string }[] = [
  { field: "manual", label: "Manual (drag)" },
  { field: "name", label: "Name" },
  { field: "modified", label: "Date modified" },
  { field: "created", label: "Date created" },
  { field: "size", label: "Size" },
];

interface FolderSortMenuProps {
  /** Folder path (`""` = root) whose sidebar sort this menu edits. */
  path: string;
  trigger: React.ReactNode;
}

/**
 * Per-folder sidebar sort picker. Sorting is independent of the folder's table
 * view (locked with the user), so this writes `treeSort` only. Picking a field
 * keeps the current direction; picking the already-selected field flips it.
 * Every folder — nested or not — gets the same menu.
 */
export function FolderSortMenu({ path, trigger }: FolderSortMenuProps) {
  const view = useFolderViews((s) => s.views[path]);
  const patch = useFolderViews((s) => s.patch);
  const current: TreeSort = view?.treeSort ?? { by: "manual", dir: "asc" };

  function choose(field: TreeSortField) {
    const dir: SortDir =
      current.by === field ? (current.dir === "asc" ? "desc" : "asc") : current.dir;
    void patch(path, { treeSort: { by: field, dir } });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="folder-sort-menu" align="start">
        <div className="folder-sort-heading">Sort by</div>
        {FIELDS.map(({ field, label }) => {
          const active = current.by === field;
          return (
            <button
              key={field}
              className={cn("folder-sort-option", active && "active")}
              onClick={() => choose(field)}
            >
              <span className="folder-sort-check">{active && <Check size={13} />}</span>
              <span className="folder-sort-label">{label}</span>
              {active && field !== "manual" && (
                <span className="folder-sort-dir">
                  {current.dir === "asc" ? <ArrowUpAZ size={13} /> : <ArrowDownAZ size={13} />}
                </span>
              )}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
