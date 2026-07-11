import { useCallback, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUpDown, ChevronDown, ChevronRight, Pencil, Smile, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Icon, TreeNode } from "@/services";
import { folderKey, noteKey, useFolderViews } from "@/store/folderViews";
import { useFolderGroups } from "@/store/folderGroups";
import { flattenWithGroups, reorderKeys, type NavRow } from "./flatten";
import { NoteIcon } from "./NoteIcon";
import { IconPicker } from "./IconPicker";
import { FolderSortMenu } from "./FolderSortMenu";
import { canDropOnFolder, DRAG_MIME, serializeDragPayload, type DragPayload } from "./dragDrop";

const ROW_HEIGHT = 28;

interface NavTreeProps {
  tree: TreeNode[];
  vaultPath: string;
  openNoteId: string | null;
  expandedFolders: ReadonlySet<string>;
  onToggleFolder: (path: string) => void;
  onSelectNote: (id: string) => void;
  /** Open a folder's table ("database") view in the main pane. */
  onOpenFolder: (path: string) => void;
  onMoveNote: (id: string, folder: string) => void;
  onMoveFolder: (path: string, newParent: string) => void;
  onRenameNote: (id: string, newTitle: string) => void;
  onRenameFolder: (path: string, newName: string) => void;
  onRequestDeleteNote: (id: string, title: string) => void;
  onRequestDeleteFolder: (path: string, name: string, hasChildren: boolean) => void;
  onSetNoteIcon: (id: string, icon: Icon | null) => void;
  /** Confirm-and-delete a folder group (folders survive; only the grouping is removed). */
  onRequestDeleteGroup: (id: string, name: string) => void;
}

type EditingKey =
  | { kind: "note"; id: string }
  | { kind: "folder"; path: string }
  | { kind: "group"; id: string };

/** Where a drag would land relative to a row: into a folder, reordered among
 *  siblings, or assigned to a folder group (dropping a top-level folder on a header). */
type DropIntent =
  | { kind: "into"; folderPath: string }
  | { kind: "reorder"; parent: string; targetKey: string; position: "before" | "after" }
  | { kind: "assign"; groupId: string };

/** A top-level folder (single path segment) — the only thing a group can hold. */
const isTopLevel = (path: string) => path !== "" && !path.includes("/");

/**
 * Virtualized folder/note tree (CLAUDE.md Phase 1 preamble: design for a
 * ~50k-note vault) with move + reorder (native HTML5 drag-and-drop — no DnD
 * library), inline rename, per-folder sort, per-folder/note icons, and delete.
 *
 * The top level is laid out into user-defined **folder groups** (collapsible
 * sections holding top-level folders) followed by everything ungrouped — see
 * `flattenWithGroups`. Ordering within a folder is per-folder and lives in the
 * `folderViews` store: a field sort or the user's manual drag order. Dragging a
 * row onto a sibling's top/bottom edge reorders; dropping onto a folder's body
 * moves into it; dropping a top-level folder onto a group header assigns it there.
 */
export function NavTree({
  tree,
  vaultPath,
  openNoteId,
  expandedFolders,
  onToggleFolder,
  onSelectNote,
  onOpenFolder,
  onMoveNote,
  onMoveFolder,
  onRenameNote,
  onRenameFolder,
  onRequestDeleteNote,
  onRequestDeleteFolder,
  onSetNoteIcon,
  onRequestDeleteGroup,
}: NavTreeProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const views = useFolderViews((s) => s.views);
  const patch = useFolderViews((s) => s.patch);
  const groups = useFolderGroups((s) => s.groups);
  const assignFolderToGroup = useFolderGroups((s) => s.assign);
  const setGroupCollapsed = useFolderGroups((s) => s.setCollapsed);
  const setGroupIcon = useFolderGroups((s) => s.setIcon);
  const renameGroup = useFolderGroups((s) => s.rename);
  const getView = useCallback((path: string) => views[path] ?? {}, [views]);
  const rows = useMemo(
    () => flattenWithGroups(tree, groups, expandedFolders, getView),
    [tree, groups, expandedFolders, getView],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // Tracked locally rather than read from `dataTransfer` during dragover: per
  // the HTML5 DnD spec, drag payload values (only `.types`) aren't readable
  // until drop, so the drop-target guard needs the payload kept in state.
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [dropIntent, setDropIntent] = useState<DropIntent | null>(null);
  const [editing, setEditing] = useState<EditingKey | null>(null);
  const [editValue, setEditValue] = useState("");

  /** The drag key ("note:x" / "folder:name") for a row's payload (folder/note only). */
  const rowKeyOf = (row: NavRow) =>
    row.kind === "folder" ? folderKey(row.name) : row.kind === "note" ? noteKey(row.id) : "";
  /** A parent folder's children keys in current display order (from the flattened rows). */
  const siblingKeysOf = (parent: string) =>
    rows.filter((r) => (r.kind === "folder" || r.kind === "note") && r.parent === parent).map(rowKeyOf);

  function startDrag(e: React.DragEvent, payload: DragPayload) {
    setDragging(payload);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(DRAG_MIME, serializeDragPayload(payload));
  }

  function endDrag() {
    setDragging(null);
    setDropIntent(null);
  }

  /** Same item as the one being dragged? (can't drop relative to yourself) */
  function isSelf(row: NavRow): boolean {
    if (!dragging) return true;
    return dragging.kind === "note"
      ? row.kind === "note" && row.id === dragging.id
      : row.kind === "folder" && row.path === dragging.path;
  }

  function computeIntent(e: React.DragEvent, row: NavRow): DropIntent | null {
    if (!dragging || isSelf(row)) return null;

    // Drop a top-level folder onto a group header → assign it to that group.
    if (row.kind === "group") {
      return dragging.kind === "folder" && isTopLevel(dragging.path)
        ? { kind: "assign", groupId: row.id }
        : null;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const offset = (e.clientY - rect.top) / rect.height;

    if (row.kind === "folder") {
      // Top/bottom quarters reorder; the wide middle drops INTO the folder.
      if (offset < 0.25 && canDropOnFolder(dragging, row.parent)) {
        return { kind: "reorder", parent: row.parent, targetKey: rowKeyOf(row), position: "before" };
      }
      if (offset > 0.75 && canDropOnFolder(dragging, row.parent)) {
        return { kind: "reorder", parent: row.parent, targetKey: rowKeyOf(row), position: "after" };
      }
      return canDropOnFolder(dragging, row.path) ? { kind: "into", folderPath: row.path } : null;
    }
    // Note row: top half = before, bottom half = after.
    if (!canDropOnFolder(dragging, row.parent)) return null;
    return {
      kind: "reorder",
      parent: row.parent,
      targetKey: rowKeyOf(row),
      position: offset < 0.5 ? "before" : "after",
    };
  }

  function dragOverRow(e: React.DragEvent, row: NavRow) {
    const intent = computeIntent(e, row);
    if (!intent) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropIntent(intent);
  }

  async function applyReorder(
    parent: string,
    targetKey: string,
    position: "before" | "after",
    payload: DragPayload,
  ) {
    const draggedKey =
      payload.kind === "note" ? noteKey(payload.id) : folderKey(payload.path.split("/").pop()!);
    // Is the dragged item already a direct child of `parent`?
    const sameParent =
      payload.kind === "folder"
        ? payload.path.split("/").slice(0, -1).join("/") === parent
        : rows.some((r) => r.kind === "note" && r.id === payload.id && r.parent === parent);
    if (!sameParent) {
      if (payload.kind === "note") onMoveNote(payload.id, parent);
      else onMoveFolder(payload.path, parent);
    }
    const order = reorderKeys(siblingKeysOf(parent), draggedKey, targetKey, position);
    await patch(parent, { treeSort: { by: "manual", dir: "asc" }, manualOrder: order });
  }

  function dropOnRow(e: React.DragEvent, row: NavRow) {
    e.preventDefault();
    const intent = computeIntent(e, row);
    const payload = dragging;
    setDropIntent(null);
    setDragging(null);
    if (!intent || !payload) return;
    if (intent.kind === "assign") {
      if (payload.kind === "folder") void assignFolderToGroup(payload.path, intent.groupId);
    } else if (intent.kind === "into") {
      if (payload.kind === "note") onMoveNote(payload.id, intent.folderPath);
      else onMoveFolder(payload.path, intent.folderPath);
    } else {
      void applyReorder(intent.parent, intent.targetKey, intent.position, payload);
    }
  }

  function dropOnRoot(e: React.DragEvent) {
    e.preventDefault();
    const payload = dragging;
    setDropIntent(null);
    setDragging(null);
    if (!payload || !canDropOnFolder(payload, "")) return;
    if (payload.kind === "note") {
      onMoveNote(payload.id, "");
    } else {
      // Only an actual move for a nested folder; a top-level folder is already at
      // root, so dropping it here just ungroups it (no pointless "already exists" move).
      if (payload.path.includes("/")) onMoveFolder(payload.path, "");
      void assignFolderToGroup(payload.path, null);
    }
  }

  function startRename(key: EditingKey, currentValue: string) {
    setEditing(key);
    setEditValue(currentValue);
  }

  function commitRename() {
    if (!editing) return;
    const value = editValue.trim();
    if (value) {
      if (editing.kind === "note") onRenameNote(editing.id, value);
      else if (editing.kind === "folder") onRenameFolder(editing.path, value);
      else void renameGroup(editing.id, value);
    }
    setEditing(null);
  }

  function renameKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") commitRename();
    else if (e.key === "Escape") setEditing(null);
  }

  const rootDroppable = dragging !== null && canDropOnFolder(dragging, "") && dropIntent === null;

  return (
    <>
      {/* Persistent drop target for "move to vault root" (also ungroups a folder
          dropped here) — the virtualized rows below only cover what's in view. */}
      <div
        className={cn("nav-root-target", rootDroppable && "droppable")}
        onDragOver={(e) => {
          if (dragging && canDropOnFolder(dragging, "")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }
        }}
        onDrop={dropOnRoot}
      >
        Vault
      </div>

      {rows.length === 0 ? (
        <div className="nav-tree-scroll">
          <p className="muted empty-hint">No notes yet</p>
        </div>
      ) : (
        <div ref={parentRef} className="nav-tree-scroll" data-testid="nav-tree-scroll">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              const rowKey =
                row.kind === "folder"
                  ? `folder:${row.path}`
                  : row.kind === "note"
                    ? `note:${row.id}`
                    : `group:${row.id}`;
              const isEditing =
                editing !== null &&
                ((editing.kind === "folder" && row.kind === "folder" && editing.path === row.path) ||
                  (editing.kind === "note" && row.kind === "note" && editing.id === row.id) ||
                  (editing.kind === "group" && row.kind === "group" && editing.id === row.id));

              const intentHere =
                dropIntent?.kind === "reorder" &&
                (row.kind === "folder" || row.kind === "note") &&
                dropIntent.parent === row.parent &&
                dropIntent.targetKey === rowKeyOf(row)
                  ? dropIntent.position
                  : dropIntent?.kind === "into" && row.kind === "folder" && dropIntent.folderPath === row.path
                    ? "into"
                    : dropIntent?.kind === "assign" && row.kind === "group" && dropIntent.groupId === row.id
                      ? "into"
                      : null;

              const editIndent =
                row.kind === "group"
                  ? 28
                  : row.kind === "folder"
                    ? row.depth * 16 + 8
                    : row.depth * 16 + 28;

              return (
                <div
                  key={rowKey}
                  className={cn(
                    "nav-row-wrap",
                    intentHere === "into" && "drag-over",
                    intentHere === "before" && "reorder-before",
                    intentHere === "after" && "reorder-after",
                  )}
                  data-testid="nav-row"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: item.size,
                    transform: `translateY(${item.start}px)`,
                  }}
                  draggable={!isEditing && row.kind !== "group"}
                  onDragStart={(e) => {
                    if (row.kind === "folder") startDrag(e, { kind: "folder", path: row.path });
                    else if (row.kind === "note") startDrag(e, { kind: "note", id: row.id });
                  }}
                  onDragEnd={endDrag}
                  onDragOver={(e) => dragOverRow(e, row)}
                  onDrop={(e) => dropOnRow(e, row)}
                >
                  {isEditing ? (
                    <input
                      autoFocus
                      className="nav-row-edit"
                      style={{ marginLeft: editIndent }}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={renameKeyDown}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : row.kind === "group" ? (
                    <div className="nav-row nav-row-group" style={{ paddingLeft: 8 }}>
                      <button
                        className="nav-folder-chevron"
                        title={row.collapsed ? "Expand group" : "Collapse group"}
                        onClick={() => void setGroupCollapsed(row.id, !row.collapsed)}
                      >
                        {row.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </button>
                      <IconPicker
                        onChange={(icon) => void setGroupIcon(row.id, icon)}
                        trigger={
                          <button className="nav-group-icon" title="Set group icon" onClick={(e) => e.stopPropagation()}>
                            <NoteIcon icon={row.icon} vaultPath={vaultPath} fallback="group" className="h-4 w-4 shrink-0" />
                          </button>
                        }
                      />
                      <button
                        className="nav-group-label"
                        onClick={() => void setGroupCollapsed(row.id, !row.collapsed)}
                      >
                        <span className="nav-row-label">{row.name}</span>
                        <span className="nav-group-count">{row.folderCount}</span>
                      </button>
                    </div>
                  ) : row.kind === "folder" ? (
                    <div className="nav-row nav-row-folder" style={{ paddingLeft: row.depth * 16 + 8 }}>
                      <button
                        className="nav-folder-chevron"
                        title={row.expanded ? "Collapse" : "Expand"}
                        onClick={() => onToggleFolder(row.path)}
                      >
                        {row.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <button className="nav-folder-label" title="Open folder table" onClick={() => onOpenFolder(row.path)}>
                        <NoteIcon icon={row.icon} vaultPath={vaultPath} fallback="folder" className="h-4 w-4 shrink-0" />
                        <span className="nav-row-label">{row.name}</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      className={cn("nav-row nav-row-note", row.id === openNoteId && "active")}
                      style={{ paddingLeft: row.depth * 16 + 28 }}
                      onClick={() => onSelectNote(row.id)}
                    >
                      <NoteIcon icon={row.icon} vaultPath={vaultPath} className="h-4 w-4 shrink-0" />
                      <span className="nav-row-label">{row.title}</span>
                    </button>
                  )}

                  {!isEditing && (
                    <div className="nav-row-actions">
                      {row.kind === "folder" && (
                        <FolderSortMenu
                          path={row.path}
                          trigger={
                            <button className="nav-row-action" title="Sort folder" onClick={(e) => e.stopPropagation()}>
                              <ArrowUpDown size={12} />
                            </button>
                          }
                        />
                      )}
                      {(row.kind === "folder" || row.kind === "note") && (
                        <IconPicker
                          onChange={(icon) =>
                            row.kind === "folder"
                              ? void patch(row.path, { icon: icon ?? undefined })
                              : onSetNoteIcon(row.id, icon)
                          }
                          trigger={
                            <button className="nav-row-action" title="Set icon" onClick={(e) => e.stopPropagation()}>
                              <Smile size={12} />
                            </button>
                          }
                        />
                      )}
                      <button
                        className="nav-row-action"
                        title="Rename"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (row.kind === "folder") startRename({ kind: "folder", path: row.path }, row.name);
                          else if (row.kind === "note") startRename({ kind: "note", id: row.id }, row.title);
                          else startRename({ kind: "group", id: row.id }, row.name);
                        }}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        className="nav-row-action"
                        title={row.kind === "group" ? "Delete group" : "Delete"}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (row.kind === "folder") onRequestDeleteFolder(row.path, row.name, row.hasChildren);
                          else if (row.kind === "note") onRequestDeleteNote(row.id, row.title);
                          else onRequestDeleteGroup(row.id, row.name);
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
