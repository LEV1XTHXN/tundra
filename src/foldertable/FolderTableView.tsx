import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { format, parseISO } from "date-fns";
import { Folder as FolderIcon, Pin } from "lucide-react";
import { notes, type PropertyValue, type TreeNode } from "@/services";
import { NoteIcon } from "@/nav/NoteIcon";
import { type ColumnKey, type TableSort, type TableSortKey } from "@/store/folderViews";
import { cn } from "@/lib/utils";
import { columnKeyStr, orderRows, propertyValue, type TableRow } from "./ordering";
import { ColumnHeader } from "./ColumnHeader";
import { AddColumnPopover } from "./AddColumnPopover";
import { SortMenu } from "./SortMenu";
import { PropertyCell } from "./PropertyCell";
import { useFolderSchema } from "./useFolderSchema";

const ROW_HEIGHT = 40;
const MIN_COL_WIDTH = 90;

/** Per-column default width (px) when the user hasn't resized it. */
function defaultWidth(key: TableSortKey): number {
  if (key === "name") return 260;
  if (key === "size") return 120;
  if (key === "modified" || key === "created") return 200;
  return 190; // custom property
}

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

/** "1.2 KB" style size, matching a file manager. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return format(parseISO(iso), "MMM d, yyyy, h:mm a");
  } catch {
    return iso;
  }
}

/**
 * The folder "database" table (opened by clicking a folder in the sidebar). Shows
 * the folder's subfolders (drill-in rows) and notes, with a fixed Name column
 * plus user-chosen built-in/custom columns. Sorting is the folder's own
 * `tableSort` — independent of the sidebar tree order (locked with the user).
 * Property values are edited inline and persisted per note via `notes.setProperty`.
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
  const parentRef = useRef<HTMLDivElement>(null);
  const headScrollRef = useRef<HTMLDivElement>(null);
  const schema = useFolderSchema(folderPath);
  const { columns, tableSort, propsById } = schema;

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

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  // How many rows are pinned — used to draw a divider under the last pinned row
  // so the "pinned float to the top" grouping reads at a glance.
  const pinnedCount = useMemo(() => rows.filter((r) => r.pinned).length, [rows]);

  // Column resizing: drag a header's right edge. A live width shows during the
  // drag; it persists to the folder view config on mouse-up.
  const [resize, setResize] = useState<{ keyStr: string; startX: number; startWidth: number } | null>(null);
  const [liveWidth, setLiveWidth] = useState<{ keyStr: string; width: number } | null>(null);

  const widthOf = useCallback(
    (key: TableSortKey): number => {
      const ks = columnKeyStr(key);
      if (liveWidth && liveWidth.keyStr === ks) return liveWidth.width;
      return schema.columnWidths[ks] ?? defaultWidth(key);
    },
    [liveWidth, schema.columnWidths],
  );

  const startResize = useCallback(
    (e: React.MouseEvent, key: TableSortKey) => {
      e.preventDefault();
      e.stopPropagation();
      setResize({ keyStr: columnKeyStr(key), startX: e.clientX, startWidth: widthOf(key) });
    },
    [widthOf],
  );

  useEffect(() => {
    if (!resize) return;
    const onMove = (e: MouseEvent) => {
      const w = Math.max(MIN_COL_WIDTH, resize.startWidth + (e.clientX - resize.startX));
      setLiveWidth({ keyStr: resize.keyStr, width: w });
    };
    const onUp = () => {
      setLiveWidth((lw) => {
        if (lw) schema.setColumnWidth(lw.keyStr, lw.width);
        return null;
      });
      setResize(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.classList.add("ft-resizing");
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("ft-resizing");
    };
  }, [resize, schema]);

  /** Inline width style shared by a column's header and body cells. */
  const colStyle = useCallback(
    (key: TableSortKey) => {
      const w = widthOf(key);
      return { flex: `0 0 ${w}px`, width: w, minWidth: w } as const;
    },
    [widthOf],
  );

  const setValue = useCallback(
    async (noteId: string, propId: string, value: PropertyValue | null) => {
      try {
        await notes.setProperty(noteId, propId, value);
        onChanged();
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      }
    },
    [onChanged, onError],
  );

  // Keep the header's horizontal scroll locked to the body's, so columns stay
  // aligned once they're wide enough to scroll sideways (the header and body are
  // separate scroll containers so the body can scroll vertically on its own).
  const onBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (headScrollRef.current) headScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
  }, []);

  const crumbs = folderPath === "" ? [] : folderPath.split("/");
  const title = crumbs.length ? crumbs[crumbs.length - 1] : vaultName || "All notes";

  /** A single body cell for a built-in / property column. Folders leave them blank. */
  function renderCell(row: TableRow, col: ColumnKey) {
    if (row.kind === "folder") return <span className="ft-cell-empty">—</span>;
    const s = row.summary;
    if (col === "modified") return formatDate(s.modified);
    if (col === "created") return formatDate(s.created);
    if (col === "size") return formatSize(s.size ?? 0);
    const def = propsById[col.prop];
    if (!def) return null;
    return (
      <PropertyCell
        def={def}
        value={propertyValue(s, def.id)}
        onChange={(v) => void setValue(s.id, def.id, v)}
        onAddOption={(name) => schema.addOption(def.id, name)}
      />
    );
  }

  return (
    <div className="ft-root">
      <div className="ft-header">
        <nav className="ft-breadcrumbs">
          <button className="ft-crumb" onClick={() => onOpenFolder("")}>
            {vaultName || "All notes"}
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
            <SortMenu schema={schema} />
          </div>
        </div>
      </div>

      <div className="ft-table">
        <div className="ft-head-scroll" ref={headScrollRef}>
        <div className="ft-head-row">
          <div className="ft-th ft-th-name" style={colStyle("name")}>
            <span className="ft-th-name-label">Name</span>
            <div className="ft-col-resize" onMouseDown={(e) => startResize(e, "name")} title="Drag to resize" />
          </div>
          {columns.map((col) => (
            <ColumnHeader
              key={columnKeyStr(col)}
              columnKey={col}
              schema={schema}
              width={widthOf(col)}
              onResizeStart={(e) => startResize(e, col)}
            />
          ))}
          <div className="ft-th ft-th-add">
            <AddColumnPopover schema={schema} />
          </div>
        </div>
        </div>

        {rows.length === 0 ? (
          <div className="ft-empty muted">This folder is empty.</div>
        ) : (
          <div ref={parentRef} className="ft-body" onScroll={onBodyScroll}>
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index];
                const key = row.kind === "folder" ? `f:${row.path}` : `n:${row.summary.id}`;
                const isLastPinned = row.pinned && item.index === pinnedCount - 1 && pinnedCount < rows.length;
                return (
                  <div
                    key={key}
                    className={cn("ft-row", row.pinned && "pinned", isLastPinned && "last-pinned")}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: item.size,
                      transform: `translateY(${item.start}px)`,
                    }}
                  >
                    <div className="ft-td ft-td-name" style={colStyle("name")}>
                      <button
                        className="ft-name-button"
                        onClick={() =>
                          row.kind === "folder" ? onOpenFolder(row.path) : onOpenNote(row.summary.id)
                        }
                      >
                        {row.kind === "folder" ? (
                          <FolderIcon size={16} className="ft-folder-icon" />
                        ) : (
                          <NoteIcon icon={row.summary.icon} vaultPath={vaultPath} className="h-4 w-4 shrink-0" />
                        )}
                        <span className="ft-name-text">
                          {row.kind === "folder" ? row.name : row.summary.title || "Untitled"}
                        </span>
                        {row.pinned && <Pin size={12} className="ft-pin-indicator" />}
                      </button>
                    </div>
                    {columns.map((col) => (
                      <div className="ft-td" key={columnKeyStr(col)} style={colStyle(col)}>
                        {renderCell(row, col)}
                      </div>
                    ))}
                    <div className="ft-td ft-td-add" />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
