/**
 * Per-folder sidebar sort, shared by every surface that offers it (today: the
 * nav tree's context menu). Sorting is independent of the folder's table view
 * (locked with the user), so this writes `treeSort` only. Picking a field keeps
 * the current direction; picking the already-selected field flips it. Every
 * folder — nested or not — gets the same options.
 */
import { useFolderViews, type SortDir, type TreeSort, type TreeSortField } from "@/store/folderViews";

/** The sort fields, in menu order, with i18n label keys (under `nav.sort`). */
export const SORT_FIELDS: { field: TreeSortField; labelKey: string }[] = [
  { field: "manual", labelKey: "nav.sort.manual" },
  { field: "name", labelKey: "nav.sort.name" },
  { field: "modified", labelKey: "nav.sort.modified" },
  { field: "created", labelKey: "nav.sort.created" },
  { field: "size", labelKey: "nav.sort.size" },
];

/** The folder's current sort plus the "pick this field" action. */
export function useFolderSort(path: string): { current: TreeSort; choose: (field: TreeSortField) => void } {
  const view = useFolderViews((s) => s.views[path]);
  const patch = useFolderViews((s) => s.patch);
  const current: TreeSort = view?.treeSort ?? { by: "manual", dir: "asc" };

  const choose = (field: TreeSortField) => {
    const dir: SortDir = current.by === field ? (current.dir === "asc" ? "desc" : "asc") : current.dir;
    void patch(path, { treeSort: { by: field, dir } });
  };

  return { current, choose };
}
