import { useCallback, useState } from "react";
import { folders } from "@/services";
import type { NoteSummary } from "@/services";
import { errorMessage } from "@/lib/errorMessage";
import { useFolderGroups } from "@/store/folderGroups";

interface Params {
  refreshTree: () => Promise<NoteSummary[]>;
  setError: (msg: string | null) => void;
}

/** Bound state for a name-entry creation dialog (new folder / new group). */
export interface CreationDialog {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (name: string) => void;
  onCreate: () => void;
}

export interface CreationDialogs {
  /** Open the new-folder dialog (fresh, empty name). */
  onNewFolder: () => void;
  /** Open the new-group dialog (fresh, empty name). */
  onNewGroup: () => void;
  newFolder: CreationDialog;
  newGroup: CreationDialog;
}

/**
 * State + handlers for the two sidebar "create" dialogs. Both create at the
 * vault root (folders are dragged/nested afterward; groups start empty and are
 * filled by dragging top-level folders onto them). The returned `newFolder` /
 * `newGroup` bundles are spread straight into the dialog components, while the
 * `onNew*` openers wire the sidebar buttons.
 */
export function useCreationDialogs({ refreshTree, setError }: Params): CreationDialogs {
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  const onNewFolder = useCallback(() => {
    setNewFolderName("");
    setNewFolderOpen(true);
  }, []);

  const onNewGroup = useCallback(() => {
    setNewGroupName("");
    setNewGroupOpen(true);
  }, []);

  const createFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      // Always the vault root — no default parent (drag the folder to nest it).
      await folders.create(name);
      await refreshTree();
      setNewFolderOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [newFolderName, refreshTree, setError]);

  const createGroup = useCallback(async () => {
    const name = newGroupName.trim();
    if (!name) return;
    try {
      await useFolderGroups.getState().create(name);
      setNewGroupOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [newGroupName, setError]);

  return {
    onNewFolder,
    onNewGroup,
    newFolder: {
      open: newFolderOpen,
      onOpenChange: setNewFolderOpen,
      name: newFolderName,
      onNameChange: setNewFolderName,
      onCreate: () => void createFolder(),
    },
    newGroup: {
      open: newGroupOpen,
      onOpenChange: setNewGroupOpen,
      name: newGroupName,
      onNameChange: setNewGroupName,
      onCreate: () => void createGroup(),
    },
  };
}
