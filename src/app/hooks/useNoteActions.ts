import { useCallback } from "react";
import { folders, notes } from "@/services";
import type { Icon, NoteSummary } from "@/services";
import { errorMessage } from "@/lib/errorMessage";
import { useViewState } from "@/store/viewState";
import { useFolderGroups } from "@/store/folderGroups";

interface Params {
  refreshTree: () => Promise<NoteSummary[]>;
  setError: (msg: string | null) => void;
  /** Remount the open editor so it reloads from disk (rename/icon changes). */
  bumpEditor: () => void;
}

export interface NoteActions {
  /** Create an "Untitled" note in `folder` (`""` = vault root) and open it. */
  onNewNote: (folder?: string) => Promise<void>;
  onMoveNote: (id: string, folder: string) => Promise<void>;
  onMoveFolder: (path: string, newParent: string) => Promise<void>;
  onRenameNote: (id: string, newTitle: string) => Promise<void>;
  onRenameFolder: (path: string, newName: string) => Promise<void>;
  onSetNoteIcon: (id: string, icon: Icon | null) => Promise<void>;
  onVaultCleaned: (deletedIds: string[]) => Promise<void>;
}

/**
 * Note & folder mutations dispatched from the nav tree (Phase 1 step 6): create,
 * move, inline rename, set icon. Every path routes data through `services` and
 * calls `refreshTree` after; a rename/icon change on the *open* note also bumps
 * the editor so it reloads (it caches the title locally). Reads the open-note id
 * and navigation actions from `useViewState` rather than taking them as props.
 */
export function useNoteActions({ refreshTree, setError, bumpEditor }: Params): NoteActions {
  const openNoteId = useViewState((s) => s.openNoteId);
  const setOpenNoteId = useViewState((s) => s.setOpenNoteId);
  const openNote = useViewState((s) => s.openNote);

  const onNewNote = useCallback(
    async (folder = "") => {
      try {
        // The vault root unless the caller named a folder (the nav tree's
        // context menu does; the global shortcut doesn't).
        const note = await notes.createIn("Untitled", folder);
        await refreshTree();
        // Reveal it in the tree — a collapsed parent would hide the new note.
        if (folder) {
          const { expandedFolders, toggleFolder } = useViewState.getState();
          if (!expandedFolders.has(folder)) toggleFolder(folder);
        }
        openNote(note.id);
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [refreshTree, openNote, setError],
  );

  const onMoveNote = useCallback(
    async (id: string, folder: string) => {
      try {
        await notes.move(id, folder);
        await refreshTree();
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [refreshTree, setError],
  );

  const onMoveFolder = useCallback(
    async (path: string, newParent: string) => {
      try {
        await folders.move(path, newParent);
        // Moving a folder under another folder makes it non-top-level, so it can
        // no longer belong to a group — drop it from any (a move to root is fine).
        if (newParent !== "") await useFolderGroups.getState().dropFolder(path);
        await refreshTree();
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [refreshTree, setError],
  );

  const onRenameNote = useCallback(
    async (id: string, newTitle: string) => {
      try {
        const note = await notes.read(id);
        await notes.save({ ...note, title: newTitle });
        await refreshTree();
        if (id === openNoteId) bumpEditor();
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [openNoteId, refreshTree, bumpEditor, setError],
  );

  const onRenameFolder = useCallback(
    async (path: string, newName: string) => {
      try {
        await folders.rename(path, newName);
        // Keep a grouped top-level folder in its group after a rename (the path,
        // which is group membership's key, changed to the new leaf name).
        if (!path.includes("/")) {
          await useFolderGroups.getState().renameFolder(path, newName);
        }
        await refreshTree();
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [refreshTree, setError],
  );

  const onSetNoteIcon = useCallback(
    async (id: string, icon: Icon | null) => {
      try {
        const note = await notes.read(id);
        await notes.save({ ...note, icon: icon ?? undefined });
        await refreshTree();
        if (id === openNoteId) bumpEditor();
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [openNoteId, refreshTree, bumpEditor, setError],
  );

  // After a settings "vault cleanup", refresh the tree and close the open note
  // if it was one of the deleted empties.
  const onVaultCleaned = useCallback(
    async (deletedIds: string[]) => {
      if (deletedIds.length === 0) return;
      await refreshTree();
      if (openNoteId && deletedIds.includes(openNoteId)) {
        setOpenNoteId(null);
      }
    },
    [refreshTree, openNoteId, setOpenNoteId],
  );

  return {
    onNewNote,
    onMoveNote,
    onMoveFolder,
    onRenameNote,
    onRenameFolder,
    onSetNoteIcon,
    onVaultCleaned,
  };
}
