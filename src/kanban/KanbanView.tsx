/**
 * Kanban view (Phase 3+) — user-curated boards of notes, switched as tabs. A
 * board is a *view* onto the vault (like the calendar or quick notes), not a
 * block inside a note. Each board has columns (rows) the user fills by adding
 * notes; a column may carry a tag that is auto-applied to notes dropped in and
 * removed when they leave (the automation lives entirely in the Rust core).
 *
 * React renders and dispatches only — ALL data + persistence go through the
 * `kanban`/`notes` services (never `@tauri-apps/api` here). Every mutation
 * returns the full board list, which we drop straight into state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronsLeftRight,
  ChevronsRightLeft,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import { config, kanban, notes as notesService } from "@/services";
import type { KanbanBoard, KanbanColumn, NoteSummary } from "@/services";
import { NoteIcon } from "@/nav/NoteIcon";
import { ViewFrame } from "@/components/ViewFrame";
import {
  TAG_PALETTE,
  kanbanTagChipStyle,
  tagChipStyle,
  useKanbanTags,
  useTagColors,
} from "@/store/tagColors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { localizeError } from "@/i18n/errors";

/** The board-name dialog: creating a new board or renaming the active one. */
type BoardDialog = { mode: "create" } | { mode: "rename"; boardId: string; name: string };
/** The column editor dialog: adding a column or editing an existing one. A
 *  column's row name *is* the tag it assigns — `assignTag` toggles whether it
 *  tags notes at all (the seeded open/closed rows leave it off). */
type ColumnDialog = { mode: "add" } | { mode: "edit"; columnId: string };
/** A pending destructive action, confirmed via AlertDialog. */
type PendingDelete =
  | { kind: "board"; boardId: string; name: string }
  | { kind: "column"; boardId: string; columnId: string; name: string };

/** Where a dragged card would land, for the insertion indicator + drop index. */
type DropTarget = { columnId: string; index: number };

/** Vault-scoped Kanban view state (which columns are collapsed). Presentation
 *  config, stored under `.vault/config/kanban-view.json`, not note content. */
const VIEW_CONFIG = "kanban-view";
type KanbanViewConfig = { collapsed?: string[] };

export function KanbanView({
  vaultPath,
  onOpenNote,
  onError,
}: {
  vaultPath: string;
  onOpenNote: (id: string) => void;
  onError: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Map<string, NoteSummary>>(new Map());
  const [loading, setLoading] = useState(true);

  const [boardDialog, setBoardDialog] = useState<BoardDialog | null>(null);
  const [boardNameDraft, setBoardNameDraft] = useState("");
  const [columnDialog, setColumnDialog] = useState<ColumnDialog | null>(null);
  const [columnNameDraft, setColumnNameDraft] = useState("");
  /** Whether this row assigns a tag (= its name) to notes dropped in it. */
  const [columnAssignTag, setColumnAssignTag] = useState(true);
  /** The chosen color for this row's tag (null = no color). */
  const [columnColorDraft, setColumnColorDraft] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  /** The column whose "add note" picker is open (null = closed). */
  const [pickerColumnId, setPickerColumnId] = useState<string | null>(null);
  /** Collapsed column ids — persisted in vault config so it survives reopen. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Native HTML5 drag: the note id being dragged is a ref (doesn't need to
  // re-render), the hovered drop slot is state (drives the insertion indicator).
  const dragNoteId = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  // A separate channel for dragging whole columns (reorder). `columnDrop` is the
  // insertion GAP index: gap g means "before the column at index g". Only the
  // middle columns move — the first/last are Open/Closed bookends.
  const dragColumnId = useRef<string | null>(null);
  const [columnDrop, setColumnDrop] = useState<number | null>(null);

  // Tag colors (vault-scoped, shared store). Subscribing to the map re-renders
  // chips live when a color is set from here or the note inspector.
  const tagColors = useTagColors((s) => s.colors);
  const setTagColor = useTagColors((s) => s.setColor);

  const refreshSummaries = useCallback(async () => {
    const list = await notesService.list();
    setSummaries(new Map(list.map((n) => [n.id, n])));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [b, list, view] = await Promise.all([
          kanban.boards(),
          notesService.list(),
          config.read<KanbanViewConfig>(VIEW_CONFIG),
        ]);
        if (cancelled) return;
        setBoards(b);
        setSummaries(new Map(list.map((n) => [n.id, n])));
        setActiveId(b[0]?.id ?? null);
        setCollapsed(new Set(view?.collapsed ?? []));
      } catch (e) {
        if (!cancelled) onError(localizeError(e, t));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onError]);

  /** Collapse/expand a column, persisting the set to vault config. */
  const toggleCollapse = useCallback((columnId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(columnId)) next.delete(columnId);
      else next.add(columnId);
      void config.write(VIEW_CONFIG, { collapsed: [...next] });
      return next;
    });
  }, []);

  const board = useMemo(() => boards.find((b) => b.id === activeId) ?? null, [boards, activeId]);

  // The Kanban view holds the authoritative board list, so it keeps the global
  // Kanban-tag set live (columns/tags can change here). Chips elsewhere (the
  // inspector) read that set to render Kanban tags distinctly.
  useEffect(() => {
    useKanbanTags.getState().setFromBoards(boards);
  }, [boards]);

  // Tags owned by *any* column on *any* board — a card's tag list mixes these
  // (Kanban-managed) with plain tags, and only the former get the outline style.
  const kanbanTagSet = useMemo(
    () => new Set(boards.flatMap((b) => b.columns.map((c) => c.tag).filter((t): t is string => !!t))),
    [boards],
  );

  /** Apply a mutation's returned board list, keeping the active tab valid.
   *  `select: "last"` switches to the newest board (used after create). */
  const commit = useCallback(
    async (p: Promise<KanbanBoard[]>, select?: "last") => {
      try {
        const next = await p;
        setBoards(next);
        setActiveId((cur) => {
          if (select === "last") return next[next.length - 1]?.id ?? null;
          if (cur && next.some((b) => b.id === cur)) return cur;
          return next[0]?.id ?? null;
        });
        // Card moves change note tags in the core; refresh so card chips stay current.
        await refreshSummaries();
      } catch (e) {
        onError(localizeError(e, t));
      }
    },
    [refreshSummaries, onError, t],
  );

  // --- board tab actions -------------------------------------------------

  const openCreateBoard = () => {
    setBoardNameDraft("");
    setBoardDialog({ mode: "create" });
  };
  const openRenameBoard = () => {
    if (!board) return;
    setBoardNameDraft(board.name);
    setBoardDialog({ mode: "rename", boardId: board.id, name: board.name });
  };
  const submitBoardDialog = () => {
    const name = boardNameDraft.trim();
    if (!name || !boardDialog) return;
    if (boardDialog.mode === "create") void commit(kanban.createBoard(name), "last");
    else void commit(kanban.renameBoard(boardDialog.boardId, name));
    setBoardDialog(null);
  };

  // --- column actions ----------------------------------------------------

  const openAddColumn = () => {
    setColumnNameDraft("");
    setColumnAssignTag(true);
    setColumnColorDraft(null);
    setColumnDialog({ mode: "add" });
  };
  const openEditColumn = (col: KanbanColumn) => {
    setColumnNameDraft(col.name);
    setColumnAssignTag(col.tag != null);
    setColumnColorDraft(col.tag ? tagColors[col.tag] ?? null : null);
    setColumnDialog({ mode: "edit", columnId: col.id });
  };
  const submitColumnDialog = () => {
    if (!board || !columnDialog) return;
    const boardId = board.id;
    const name = columnNameDraft.trim() || t("kanban.newColumnDefault");
    // The row's name IS the tag it assigns; `assignTag` off means a plain,
    // tag-free row (like the seeded Open/Closed bookends).
    const tag = columnAssignTag ? name : null;
    setColumnDialog(null);
    // Persist the tag's color choice (vault-wide) alongside the column change.
    if (tag) void setTagColor(tag, columnColorDraft);

    if (columnDialog.mode === "edit") {
      void commit(kanban.updateColumn(boardId, columnDialog.columnId, name, tag));
      return;
    }
    // New columns are appended by the core, then slid to just before the Closed
    // bookend so every user row lives BETWEEN Open and Closed.
    void commit(
      (async () => {
        let next = await kanban.addColumn(boardId, name, tag);
        const b = next.find((x) => x.id === boardId);
        if (b && b.columns.length >= 3) {
          const added = b.columns[b.columns.length - 1];
          next = await kanban.moveColumn(boardId, added.id, b.columns.length - 2);
        }
        return next;
      })(),
    );
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    if (pendingDelete.kind === "board") void commit(kanban.deleteBoard(pendingDelete.boardId));
    else void commit(kanban.deleteColumn(pendingDelete.boardId, pendingDelete.columnId));
    setPendingDelete(null);
  };

  // --- card actions + drag-and-drop --------------------------------------

  const onCardDragStart = (e: React.DragEvent, noteId: string) => {
    dragNoteId.current = noteId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", noteId);
  };
  const onDragEnd = () => {
    dragNoteId.current = null;
    setDropTarget(null);
  };
  // Hovering a card targets the slot BEFORE it; stop propagation so the column's
  // own handler (which targets the end) doesn't override the finer position.
  const onCardDragOver = (e: React.DragEvent, columnId: string, index: number) => {
    if (!dragNoteId.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDropTarget({ columnId, index });
  };
  const onColumnDragOver = (e: React.DragEvent, columnId: string, length: number) => {
    if (!dragNoteId.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget({ columnId, index: length });
  };
  const onColumnDrop = (e: React.DragEvent, column: KanbanColumn) => {
    e.preventDefault();
    const noteId = dragNoteId.current;
    const target = dropTarget;
    dragNoteId.current = null;
    setDropTarget(null);
    if (!noteId || !board) return;
    const index =
      target && target.columnId === column.id ? target.index : column.note_ids.length;
    void commit(kanban.moveCard(board.id, noteId, column.id, index));
  };

  // --- column reorder drag (bookends stay put) ---------------------------

  const columnCount = board?.columns.length ?? 0;
  /** The first and last columns are the Open/Closed bookends — not draggable. */
  const isBookend = (index: number) => index === 0 || index === columnCount - 1;

  const onColumnHeaderDragStart = (e: React.DragEvent, columnId: string) => {
    dragColumnId.current = columnId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", columnId);
  };
  const onColumnHeaderDragEnd = () => {
    dragColumnId.current = null;
    setColumnDrop(null);
  };
  /** Hover over a column while dragging another: pick the nearer gap (before/after
   *  by horizontal midpoint), clamped to stay between the bookends. */
  const onColumnReorderOver = (e: React.DragEvent, index: number) => {
    if (!dragColumnId.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width / 2;
    const gap = Math.min(Math.max(after ? index + 1 : index, 1), columnCount - 1);
    setColumnDrop(gap);
  };
  const onColumnReorderDrop = () => {
    const id = dragColumnId.current;
    const gap = columnDrop;
    dragColumnId.current = null;
    setColumnDrop(null);
    if (!id || gap == null || !board) return;
    const old = board.columns.findIndex((c) => c.id === id);
    if (old < 0) return;
    // move_column removes then inserts, so the post-removal target shifts left by
    // one when the column came from the left of the gap. Clamp inside the bookends.
    let to = old < gap ? gap - 1 : gap;
    to = Math.min(Math.max(to, 1), columnCount - 2);
    if (to === old) return;
    void commit(kanban.moveColumn(board.id, id, to));
  };

  const addCardFromPicker = (columnId: string, noteId: string) => {
    if (!board) return;
    setPickerColumnId(null);
    void commit(kanban.addCard(board.id, columnId, noteId));
  };
  const removeCard = (noteId: string) => {
    if (!board) return;
    void commit(kanban.removeCard(board.id, noteId));
  };

  /** Note ids already placed anywhere on the active board — excluded from the picker. */
  const onBoard = useMemo(() => {
    const set = new Set<string>();
    board?.columns.forEach((c) => c.note_ids.forEach((id) => set.add(id)));
    return set;
  }, [board]);

  const pickableNotes = useMemo(
    () => [...summaries.values()].filter((n) => !onBoard.has(n.id)),
    [summaries, onBoard],
  );

  const boardTabs = (
    <div className="kanban-tabs" role="tablist" aria-label={t("kanban.boardsAriaLabel")}>
      {boards.map((b) => (
        <button
          key={b.id}
          role="tab"
          aria-selected={b.id === activeId}
          className={`kanban-tab${b.id === activeId ? " active" : ""}`}
          onClick={() => setActiveId(b.id)}
        >
          {b.name}
        </button>
      ))}
      <button className="kanban-tab-add" onClick={openCreateBoard} title={t("kanban.newBoard")} aria-label={t("kanban.newBoard")}>
        <Plus className="h-4 w-4" />
      </button>
      <div className="kanban-tabs-spacer" />
      {board && (
        <Popover>
          <PopoverTrigger asChild>
            <button className="kanban-board-menu" title={t("kanban.boardOptions")} aria-label={t("kanban.boardOptions")}>
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="kanban-menu">
            <button className="kanban-menu-item" onClick={openRenameBoard}>
              <Pencil className="h-4 w-4" /> {t("kanban.renameBoard")}
            </button>
            <button
              className="kanban-menu-item danger"
              onClick={() => setPendingDelete({ kind: "board", boardId: board.id, name: board.name })}
            >
              <Trash2 className="h-4 w-4" /> {t("kanban.deleteBoard")}
            </button>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );

  if (loading) {
    return (
      <ViewFrame title={t("kanban.title")} fullBleed>
        <div className="centered muted">{t("kanban.loading")}</div>
      </ViewFrame>
    );
  }

  return (
    <ViewFrame title={t("kanban.title")} toolbar={boardTabs} fullBleed>
    <div className="kanban">
      {!board ? (
        <div className="centered muted kanban-empty">
          <p>{t("kanban.noBoardsYet")}</p>
          <Button onClick={openCreateBoard}>
            <Plus className="h-4 w-4" /> {t("kanban.createFirstBoard")}
          </Button>
        </div>
      ) : (
        <div className="kanban-columns">
          {board.columns.map((col, colIndex) => {
            const isCollapsed = collapsed.has(col.id);
            const gripEl = !isBookend(colIndex) && (
              <span
                className="kanban-column-grip"
                draggable
                onDragStart={(e) => onColumnHeaderDragStart(e, col.id)}
                onDragEnd={onColumnHeaderDragEnd}
                title={t("kanban.dragToReorder")}
                aria-label={t("kanban.dragToReorderColumn")}
              >
                <GripVertical className="h-4 w-4" />
              </span>
            );

            return (
              <section
                key={col.id}
                className={`kanban-column${isCollapsed ? " collapsed" : ""}${columnDrop === colIndex ? " drop-before" : ""}`}
                onDragOver={(e) =>
                  dragColumnId.current
                    ? onColumnReorderOver(e, colIndex)
                    : onColumnDragOver(e, col.id, col.note_ids.length)
                }
                onDrop={(e) => {
                  if (dragColumnId.current) {
                    e.preventDefault();
                    onColumnReorderDrop();
                  } else {
                    onColumnDrop(e, col);
                  }
                }}
              >
                {isCollapsed ? (
                  <div className="kanban-collapsed">
                    <button
                      className="kanban-icon-btn"
                      onClick={() => toggleCollapse(col.id)}
                      title={t("kanban.expandColumn")}
                      aria-label={t("kanban.expandColumn")}
                    >
                      <ChevronsLeftRight className="h-4 w-4" />
                    </button>
                    {gripEl}
                    {col.tag != null && (
                      <span
                        className="kanban-column-tagdot"
                        style={{ background: tagColors[col.tag] ?? "var(--muted-foreground)" }}
                        title={t("kanban.tagsNotesWith", { tag: col.tag })}
                      />
                    )}
                    <span className="kanban-collapsed-name" title={col.name}>
                      {col.name}
                    </span>
                    <span className="kanban-column-count">{col.note_ids.length}</span>
                  </div>
                ) : (
                  <>
                    <header className="kanban-column-head">
                      {gripEl}
                      <div className="kanban-column-titles">
                        {col.tag != null && (
                          <span
                            className="kanban-column-tagdot"
                            style={{ background: tagColors[col.tag] ?? "var(--muted-foreground)" }}
                            title={t("kanban.tagsNotesWith", { tag: col.tag })}
                          />
                        )}
                        <span className="kanban-column-name">{col.name}</span>
                      </div>
                      <span className="kanban-column-count">{col.note_ids.length}</span>
                      <button
                        className="kanban-icon-btn"
                        onClick={() => toggleCollapse(col.id)}
                        title={t("kanban.collapseColumn")}
                        aria-label={t("kanban.collapseColumn")}
                      >
                        <ChevronsRightLeft className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="kanban-icon-btn"
                        onClick={() => openEditColumn(col)}
                        title={t("kanban.editColumn")}
                        aria-label={t("kanban.editColumn")}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="kanban-icon-btn danger"
                        onClick={() =>
                          setPendingDelete({ kind: "column", boardId: board.id, columnId: col.id, name: col.name })
                        }
                        title={t("kanban.deleteColumn")}
                        aria-label={t("kanban.deleteColumn")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </header>

                    <div className="kanban-cards">
                      {col.note_ids.length === 0 && dropTarget?.columnId !== col.id && (
                        <p className="kanban-column-empty muted">{t("kanban.dropOrAddNotes")}</p>
                      )}
                      {col.note_ids.map((noteId, index) => {
                        const summary = summaries.get(noteId);
                        const cardTags = summary?.tags ?? [];
                        const isDropSlot = dropTarget?.columnId === col.id && dropTarget.index === index;
                        return (
                          <div key={noteId}>
                            {isDropSlot && <div className="kanban-drop-line" />}
                            <div
                              className="kanban-card"
                              draggable
                              onDragStart={(e) => onCardDragStart(e, noteId)}
                              onDragEnd={onDragEnd}
                              onDragOver={(e) => onCardDragOver(e, col.id, index)}
                            >
                              <GripVertical className="kanban-card-grip h-4 w-4" aria-hidden />
                              <div className="kanban-card-body">
                                {summary ? (
                                  <button
                                    className="kanban-card-open"
                                    onClick={() => onOpenNote(noteId)}
                                    title={t("kanban.openNote")}
                                  >
                                    <NoteIcon icon={summary.icon} vaultPath={vaultPath} className="h-4 w-4" />
                                    <span className="kanban-card-title">{summary.title || t("common.untitled")}</span>
                                  </button>
                                ) : (
                                  <span className="kanban-card-open kanban-card-missing muted">
                                    {t("kanban.missingNote")}
                                  </span>
                                )}
                                {cardTags.length > 0 && (
                                  <div className="kanban-card-tags">
                                    {cardTags.map((t) => (
                                      <span
                                        key={t}
                                        className="kanban-tag-chip small"
                                        style={
                                          kanbanTagSet.has(t)
                                            ? kanbanTagChipStyle(tagColors[t])
                                            : tagChipStyle(tagColors[t])
                                        }
                                      >
                                        #{t}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <button
                                className="kanban-card-remove"
                                onClick={() => removeCard(noteId)}
                                title={t("kanban.removeFromBoard")}
                                aria-label={t("kanban.removeFromBoard")}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {/* Trailing insertion indicator when dropping at the end. */}
                      {dropTarget?.columnId === col.id && dropTarget.index >= col.note_ids.length && (
                        <div className="kanban-drop-line" />
                      )}
                    </div>

                    <button className="kanban-add-card" onClick={() => setPickerColumnId(col.id)}>
                      <Plus className="h-4 w-4" /> {t("kanban.addNote")}
                    </button>
                  </>
                )}
              </section>
            );
          })}

          <button className="kanban-add-column" onClick={openAddColumn}>
            <Plus className="h-4 w-4" /> {t("kanban.addColumn")}
          </button>
        </div>
      )}

      {/* Note picker for a specific column. */}
      <CommandDialog
        open={pickerColumnId !== null}
        onOpenChange={(open) => !open && setPickerColumnId(null)}
        title={t("kanban.addNoteToBoard")}
        description={t("kanban.searchForNote")}
      >
        <Command>
          <CommandInput placeholder={t("kanban.searchNotesPlaceholder")} />
          <CommandList>
            <CommandEmpty>
              {pickableNotes.length === 0
                ? t("kanban.everyNoteOnBoard")
                : t("kanban.noNotesFound")}
            </CommandEmpty>
            <CommandGroup heading={t("kanban.notesHeading")}>
              {pickableNotes.map((n) => (
                <CommandItem
                  key={n.id}
                  value={`${n.title} ${n.id}`}
                  onSelect={() => pickerColumnId && addCardFromPicker(pickerColumnId, n.id)}
                >
                  <NoteIcon icon={n.icon} vaultPath={vaultPath} className="h-4 w-4" />
                  <span>{n.title || t("common.untitled")}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>

      {/* Board name dialog (create / rename). */}
      <Dialog open={boardDialog !== null} onOpenChange={(open) => !open && setBoardDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{boardDialog?.mode === "rename" ? t("kanban.renameBoard") : t("kanban.newBoardTitle")}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitBoardDialog();
            }}
          >
            <Input
              autoFocus
              value={boardNameDraft}
              onChange={(e) => setBoardNameDraft(e.target.value)}
              placeholder={t("kanban.boardNamePlaceholder")}
            />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setBoardDialog(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={!boardNameDraft.trim()}>
                {boardDialog?.mode === "rename" ? t("kanban.rename") : t("kanban.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Column editor dialog (add / edit). */}
      <Dialog open={columnDialog !== null} onOpenChange={(open) => !open && setColumnDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{columnDialog?.mode === "edit" ? t("kanban.editColumn") : t("kanban.newColumnTitle")}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitColumnDialog();
            }}
          >
            <label className="kanban-field-label">{t("kanban.rowName")}</label>
            <Input
              autoFocus
              value={columnNameDraft}
              onChange={(e) => setColumnNameDraft(e.target.value)}
              placeholder={t("kanban.rowNamePlaceholder")}
            />
            <label className="kanban-checkbox-row">
              <input
                type="checkbox"
                checked={columnAssignTag}
                onChange={(e) => setColumnAssignTag(e.target.checked)}
              />
              <span>{t("kanban.tagNotesCheckbox", { tag: columnNameDraft.trim() || "…" })}</span>
            </label>
            <p className="kanban-field-hint muted">{t("kanban.tagHint", { tag: columnNameDraft.trim() || "…" })}</p>
            {columnAssignTag && (
              <>
                <label className="kanban-field-label">{t("kanban.tagColor")}</label>
                <div className="kanban-swatches">
                  <button
                    type="button"
                    className={`kanban-swatch none${columnColorDraft === null ? " selected" : ""}`}
                    onClick={() => setColumnColorDraft(null)}
                    title={t("kanban.noColor")}
                    aria-label={t("kanban.noColor")}
                  />
                  {TAG_PALETTE.map((c) => (
                    <button
                      type="button"
                      key={c}
                      className={`kanban-swatch${columnColorDraft === c ? " selected" : ""}`}
                      style={{ background: c }}
                      onClick={() => setColumnColorDraft(c)}
                      aria-label={t("kanban.colorLabel", { color: c })}
                    />
                  ))}
                </div>
              </>
            )}
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setColumnDialog(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit">{columnDialog?.mode === "edit" ? t("kanban.save") : t("kanban.addColumn")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Destructive confirm for board / column deletion. */}
      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete?.kind === "board"
                ? t("kanban.deleteBoardConfirm", { name: pendingDelete.name })
                : t("kanban.deleteColumnConfirm", { name: pendingDelete?.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.kind === "board" ? t("kanban.deleteBoardDesc") : t("kanban.deleteColumnDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>{t("common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </ViewFrame>
  );
}
