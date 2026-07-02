import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, Pencil, Smile, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Icon, TreeNode } from "@/services";
import { flattenTree } from "./flatten";
import { NoteIcon } from "./NoteIcon";
import { IconPicker } from "./IconPicker";
import { canDropOnFolder, DRAG_MIME, serializeDragPayload, type DragPayload } from "./dragDrop";

const ROW_HEIGHT = 28;

interface NavTreeProps {
  tree: TreeNode[];
  vaultPath: string;
  openNoteId: string | null;
  expandedFolders: ReadonlySet<string>;
  onToggleFolder: (path: string) => void;
  onSelectNote: (id: string) => void;
  onMoveNote: (id: string, folder: string) => void;
  onMoveFolder: (path: string, newParent: string) => void;
  onRenameNote: (id: string, newTitle: string) => void;
  onRenameFolder: (path: string, newName: string) => void;
  onRequestDeleteNote: (id: string, title: string) => void;
  onRequestDeleteFolder: (path: string, name: string, hasChildren: boolean) => void;
  onSetNoteIcon: (id: string, icon: Icon | null) => void;
}

type EditingKey = { kind: "note"; id: string } | { kind: "folder"; path: string };

/**
 * Virtualized folder/note tree (CLAUDE.md Phase 1 preamble: design for a
 * ~50k-note vault) with move (native HTML5 drag-and-drop — no DnD library),
 * inline rename, and delete (via the caller's confirmation dialog).
 */
export function NavTree({
  tree,
  vaultPath,
  openNoteId,
  expandedFolders,
  onToggleFolder,
  onSelectNote,
  onMoveNote,
  onMoveFolder,
  onRenameNote,
  onRenameFolder,
  onRequestDeleteNote,
  onRequestDeleteFolder,
  onSetNoteIcon,
}: NavTreeProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => flattenTree(tree, expandedFolders), [tree, expandedFolders]);

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
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingKey | null>(null);
  const [editValue, setEditValue] = useState("");

  function startDrag(e: React.DragEvent, payload: DragPayload) {
    setDragging(payload);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(DRAG_MIME, serializeDragPayload(payload));
  }

  function endDrag() {
    setDragging(null);
    setDragOverTarget(null);
  }

  function dragOverFolder(e: React.DragEvent, folderPath: string) {
    if (!dragging || !canDropOnFolder(dragging, folderPath)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverTarget(folderPath);
  }

  function dropOnFolder(e: React.DragEvent, folderPath: string) {
    e.preventDefault();
    setDragOverTarget(null);
    if (!dragging || !canDropOnFolder(dragging, folderPath)) return;
    if (dragging.kind === "note") {
      onMoveNote(dragging.id, folderPath);
    } else {
      onMoveFolder(dragging.path, folderPath);
    }
    setDragging(null);
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

  return (
    <>
      {/* Persistent drop target for "move to vault root" — the virtualized
          rows below only cover the folders/notes actually in view. */}
      <div
        className={cn("nav-root-target", dragOverTarget === "" && "drag-over")}
        onDragOver={(e) => dragOverFolder(e, "")}
        onDragLeave={() => setDragOverTarget((t) => (t === "" ? null : t))}
        onDrop={(e) => dropOnFolder(e, "")}
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

              return (
                <div
                  key={rowKey}
                  className={cn(
                    "nav-row-wrap",
                    row.kind === "folder" && dragOverTarget === row.path && "drag-over",
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
                  onDragOver={row.kind === "folder" ? (e) => dragOverFolder(e, row.path) : undefined}
                  onDragLeave={
                    row.kind === "folder"
                      ? () => setDragOverTarget((t) => (t === row.path ? null : t))
                      : undefined
                  }
                  onDrop={row.kind === "folder" ? (e) => dropOnFolder(e, row.path) : undefined}
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
                    <button
                      className="nav-row nav-row-folder"
                      style={{ paddingLeft: row.depth * 16 + 8 }}
                      onClick={() => onToggleFolder(row.path)}
                    >
                      {row.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className="nav-row-label">{row.name}</span>
                    </button>
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
                            <button
                              className="nav-row-action"
                              title="Set icon"
                              onClick={(e) => e.stopPropagation()}
                            >
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
