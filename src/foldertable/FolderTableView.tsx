import { useMemo } from "react";
import { LayoutGrid, List } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TreeNode } from "@/services";
import { cn } from "@/lib/utils";
import { type TableSort } from "@/store/folderViews";
import { orderRows, type TableRow } from "./ordering";
import { SortMenu } from "./SortMenu";
import { useFolderSchema } from "./useFolderSchema";
import { FolderTable } from "./FolderTable";
import { FolderGallery } from "./FolderGallery";

interface FolderTableViewProps {
  folderPath: string;
  vaultName: string;
  tree: TreeNode[];
  vaultPath: string;
  onOpenNote: (id: string) => void;
  onOpenFolder: (path: string) => void;
  onError: (message: string) => void;
  /** Called after a property value changes so the caller can refresh the tree/summaries. */
  onChanged: () => void;
}

/** Walk the tree to a folder's direct children (`""` = the root's top-level nodes). */
function childrenOf(tree: TreeNode[], path: string): TreeNode[] {
  if (path === "") return tree;
  let nodes = tree;
  for (const seg of path.split("/")) {
    const found = nodes.find((n) => n.kind === "Folder" && n.data.name === seg);
    if (!found || found.kind !== "Folder") return [];
    nodes = found.data.children;
  }
  return nodes;
}

/**
 * The folder "database" view (opened by clicking a folder in the sidebar). Shows
 * the folder's subfolders (drill-in) and notes, as either a card Gallery
 * (default) or the dense sortable Table — same underlying rows/sort/schema for
 * both, `FolderGallery`/`FolderTable` just render them differently. Sorting is
 * the folder's own `tableSort` — independent of the sidebar tree order (locked
 * with the user). Property values are edited inline (Table) and persisted per
 * note via `notes.setProperty`.
 */
export function FolderTableView({
  folderPath,
  vaultName,
  tree,
  vaultPath,
  onOpenNote,
  onOpenFolder,
  onError,
  onChanged,
}: FolderTableViewProps) {
  const { t } = useTranslation();
  const schema = useFolderSchema(folderPath);
  const { tableSort, propsById, viewMode, setViewMode } = schema;

  const rows = useMemo<TableRow[]>(() => {
    const children = childrenOf(tree, folderPath);
    const mapped: TableRow[] = children.map((n) =>
      n.kind === "Folder"
        ? // Folders can no longer be pinned (tree pinning was removed); only notes
          // carry a pinned flag now (via Home's "Pin to Home").
          { kind: "folder", name: n.data.name, path: n.data.path, pinned: false }
        : { kind: "note", summary: n.data, pinned: n.data.pinned === true },
    );
    const sort: TableSort[] = tableSort.length ? tableSort : [{ key: "name", dir: "asc" }];
    return orderRows(mapped, sort, propsById);
  }, [tree, folderPath, tableSort, propsById]);

  const crumbs = folderPath === "" ? [] : folderPath.split("/");
  const title = crumbs.length ? crumbs[crumbs.length - 1] : vaultName || t("folderView.allNotes");

  return (
    <div className="ft-root">
      <div className="ft-header">
        <nav className="ft-breadcrumbs">
          <button className="ft-crumb" onClick={() => onOpenFolder("")}>
            {vaultName || t("folderView.allNotes")}
          </button>
          {crumbs.map((seg, i) => (
            <span key={i} className="ft-crumb-wrap">
              <span className="ft-crumb-sep">/</span>
              <button className="ft-crumb" onClick={() => onOpenFolder(crumbs.slice(0, i + 1).join("/"))}>
                {seg}
              </button>
            </span>
          ))}
        </nav>
        <div className="ft-title-row">
          <h1 className="ft-title">{title}</h1>
          <div className="ft-toolbar">
            <div className="ft-view-toggle" role="group" aria-label={t("folderView.view")}>
              <button
                className={cn("ft-view-toggle-btn", viewMode === "gallery" && "active")}
                onClick={() => setViewMode("gallery")}
                title={t("folderView.galleryView")}
              >
                <LayoutGrid size={14} />
                {t("folderView.gallery")}
              </button>
              <button
                className={cn("ft-view-toggle-btn", viewMode === "list" && "active")}
                onClick={() => setViewMode("list")}
                title={t("folderView.listView")}
              >
                <List size={14} />
                {t("folderView.list")}
              </button>
            </div>
            <SortMenu schema={schema} />
          </div>
        </div>
      </div>

      {viewMode === "list" ? (
        <FolderTable
          rows={rows}
          schema={schema}
          vaultPath={vaultPath}
          onOpenNote={onOpenNote}
          onOpenFolder={onOpenFolder}
          onChanged={onChanged}
          onError={onError}
        />
      ) : (
        <div className="ft-gallery-wrap">
          <FolderGallery
            rows={rows}
            schema={schema}
            vaultPath={vaultPath}
            onOpenNote={onOpenNote}
            onOpenFolder={onOpenFolder}
          />
        </div>
      )}
    </div>
  );
}
