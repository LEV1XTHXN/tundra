import { useCallback, useState } from "react";
import { folders, notes, templates as templatesService } from "@/services";
import type { NoteSummary } from "@/services";
import { errorMessage } from "@/lib/errorMessage";
import { useViewState } from "@/store/viewState";
import { useTemplates } from "@/store/templates";
import { useFolderGroups } from "@/store/folderGroups";
import type { PendingDelete } from "@/app/dialogs/DeleteConfirmDialog";

interface Params {
  refreshTree: () => Promise<NoteSummary[]>;
  setError: (msg: string | null) => void;
  /** Leave the template view when the open template is the one being deleted. */
  returnFromTemplate: () => void;
}

export interface Deletion {
  pendingDelete: PendingDelete | null;
  setPendingDelete: (p: PendingDelete | null) => void;
  onRequestDeleteNote: (id: string, title: string) => void;
  onRequestDeleteFolder: (path: string, name: string, hasChildren: boolean) => void;
  onRequestDeleteTemplate: (id: string, title: string) => void;
  onRequestDeleteGroup: (id: string, name: string) => void;
  confirmDelete: () => Promise<void>;
}

/**
 * The delete state machine shared by every deletable kind. Requests park a
 * {@link PendingDelete} that the confirm dialog renders; `confirmDelete` runs
 * the kind-specific effect — note/folder deletions are destructive and close
 * the open note if it vanished; template deletion leaves the template view if
 * that template was open; group deletion is non-destructive (its folders just
 * become ungrouped). Top-level folder deletions also drop the folder from any
 * group. Reads view state from `useViewState`.
 */
export function useDeletion({ refreshTree, setError, returnFromTemplate }: Params): Deletion {
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const openNoteId = useViewState((s) => s.openNoteId);
  const setOpenNoteId = useViewState((s) => s.setOpenNoteId);
  const templateEditId = useViewState((s) => s.templateEditId);

  const onRequestDeleteNote = useCallback((id: string, title: string) => {
    setPendingDelete({ kind: "note", id, title });
  }, []);

  const onRequestDeleteFolder = useCallback(
    (path: string, name: string, hasChildren: boolean) => {
      setPendingDelete({ kind: "folder", path, name, hasChildren });
    },
    [],
  );

  const onRequestDeleteTemplate = useCallback((id: string, title: string) => {
    setPendingDelete({ kind: "template", id, title });
  }, []);

  const onRequestDeleteGroup = useCallback((id: string, name: string) => {
    setPendingDelete({ kind: "group", id, name });
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    try {
      if (pendingDelete.kind === "template") {
        const id = pendingDelete.id;
        await templatesService.delete(id);
        await useTemplates.getState().refresh();
        // If the deleted template was open for editing, leave the template view.
        if (templateEditId === id) returnFromTemplate();
        return;
      }
      if (pendingDelete.kind === "group") {
        // Deleting a group is non-destructive — its folders just become ungrouped.
        await useFolderGroups.getState().remove(pendingDelete.id);
        return;
      }
      if (pendingDelete.kind === "note") {
        await notes.delete(pendingDelete.id);
      } else {
        // A deleted top-level folder must also leave any group it was in.
        if (!pendingDelete.path.includes("/")) {
          await useFolderGroups.getState().dropFolder(pendingDelete.path);
        }
        await folders.delete(pendingDelete.path);
      }
      const list = await refreshTree();
      if (openNoteId && !list.some((n) => n.id === openNoteId)) {
        setOpenNoteId(null);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPendingDelete(null);
    }
  }, [pendingDelete, openNoteId, refreshTree, setOpenNoteId, templateEditId, returnFromTemplate, setError]);

  return {
    pendingDelete,
    setPendingDelete,
    onRequestDeleteNote,
    onRequestDeleteFolder,
    onRequestDeleteTemplate,
    onRequestDeleteGroup,
    confirmDelete,
  };
}
