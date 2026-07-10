import { useCallback, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUpDown, ChevronDown, ChevronRight, Pencil, Pin, PinOff, Smile, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Icon, TreeNode } from "@/services";
import { folderKey, noteKey, useFolderViews } from "@/store/folderViews";
import { flattenTree, reorderKeys, type NavRow } from "./flatten";
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
  /** Flip a note's pinned flag (pinned notes float to the top of the hierarchy). */
  onToggleNotePin: (id: string, pinned: boolean) => void;
}

type EditingKey = { kind: "note"; id: string } | { kind: "folder"; path: string };

/** Where a drag would land relative to a row: into a folder, or reordered among siblings. */
type DropIntent =
  | { kind: "into"; folderPath: string }
  | { kind: "reorder"; parent: string; targetKey: string; position: "before" | "after" };

/**
 * Virtualized folder/note tree (CLAUDE.md Phase 1 preamble: design for a
 * ~50k-note vault) with move + reorder (native HTML5 drag-and-drop — no DnD
 * library), inline rename, per-folder sort/pin, and delete.
 *
 * Ordering is per-folder and lives in the `folderViews` store (independent of
 * the table view): pinned items float to the top, then either a field sort or
 * the user's manual drag order. Dragging a row onto a sibling's top/bottom edge
 * reorders (switching the folder to manual order); dropping onto a folder's body
 * moves the item into it.
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
  onToggleNotePin,
}: NavTreeProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const views = useFolderViews((s) => s.views);
  const patch = useFolderViews((s) => s.patch);
  const getView = useCallback((path: string) => views[path] ?? {}, [views]);
  const rows = useMemo(() => flattenTree(tree, expandedFolders, getView), [tree, expandedFolders, getView]);

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

  /** The drag key ("note:x" / "folder:name") for a row's payload. */
  const rowKeyOf = (row: NavRow) => (row.kind === "folder" ? folderKey(row.name) : noteKey(row.id));
  /** A parent folder's children keys in current display order (from the flattened rows). */
  const siblingKeysOf = (parent: string) => rows.filter((r) => r.parent === parent).map(rowKeyOf);

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
    if (intent.kind === "into") {
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
    if (payload.kind === "note") onMoveNote(payload.id, "");
    else onMoveFolder(payload.path, "");
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
      else onRenameFolder(editing.path, value);
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
      {/* Persistent drop target for "move to vault root" — the virtualized
          rows below only cover the folders/notes actually in view. */}
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
        Vault root
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
              const rowKey = row.kind === "folder" ? `folder:${row.path}` : `note:${row.id}`;
              const isEditing =
                editing !== null &&
                ((editing.kind === "folder" && row.kind === "folder" && editing.path === row.path) ||
                  (editing.kind === "note" && row.kind === "note" && editing.id === row.id));

              const intentHere =
                dropIntent?.kind === "reorder" &&
                dropIntent.parent === row.parent &&
                dropIntent.targetKey === rowKeyOf(row)
                  ? dropIntent.position
                  : dropIntent?.kind === "into" && row.kind === "folder" && dropIntent.folderPath === row.path
                    ? "into"
                    : null;

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
                  draggable={!isEditing}
                  onDragStart={(e) =>
                    startDrag(e, row.kind === "folder" ? { kind: "folder", path: row.path } : { kind: "note", id: row.id })
                  }
                  onDragEnd={endDrag}
                  onDragOver={(e) => dragOverRow(e, row)}
                  onDrop={(e) => dropOnRow(e, row)}
                >
                  {isEditing ? (
                    <input
                      autoFocus
                      className="nav-row-edit"
                      style={{ marginLeft: row.depth * 16 + (row.kind === "folder" ? 8 : 28) }}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={renameKeyDown}
                      onClick={(e) => e.stopPropagation()}
                    />
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
                        <span className="nav-row-label">{row.name}</span>
                      </button>
                      {row.pinned && <Pin size={11} className="nav-pin-indicator" />}
                    </div>
                  ) : (
                    <button
                      className={cn("nav-row nav-row-note", row.id === openNoteId && "active")}
                      style={{ paddingLeft: row.depth * 16 + 28 }}
                      onClick={() => onSelectNote(row.id)}
                    >
                      <NoteIcon icon={row.icon} vaultPath={vaultPath} className="h-4 w-4 shrink-0" />
                      <span className="nav-row-label">{row.title}</span>
                      {row.pinned && <Pin size={11} className="nav-pin-indicator" />}
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
                      <button
                        className={cn("nav-row-action", row.pinned && "active")}
                        title={row.pinned ? "Unpin" : "Pin to top"}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (row.kind === "folder") void patch(row.path, { pinned: !row.pinned });
                          else onToggleNotePin(row.id, row.pinned);
                        }}
                      >
                        {row.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                      </button>
                      <button
                        className="nav-row-action"
                        title="Rename"
                        onClick={(e) => {
                          e.stopPropagation();
                          startRename(
                            row.kind === "folder" ? { kind: "folder", path: row.path } : { kind: "note", id: row.id },
                            row.kind === "folder" ? row.name : row.title,
                          );
                        }}
                      >
                        <Pencil size={12} />
                      </button>
                      {row.kind === "note" && (
                        <IconPicker
                          onChange={(icon) => onSetNoteIcon(row.id, icon)}
                          trigger={
                            <button className="nav-row-action" title="Set icon" onClick={(e) => e.stopPropagation()}>
                              <Smile size={12} />
                            </button>
                          }
                        />
                      )}
                      <button
                        className="nav-row-action"
                        title="Delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (row.kind === "folder") {
                            onRequestDeleteFolder(row.path, row.name, row.hasChildren);
                          } else {
                            onRequestDeleteNote(row.id, row.title);
                          }
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
