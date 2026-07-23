import { useCallback, useState } from "react";
import { folders } from "@/services";
import type { NoteSummary } from "@/services";
import { errorMessage } from "@/lib/errorMessage";
import { useFolderGroups } from "@/store/folderGroups";
import { useViewState } from "@/store/viewState";

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
  /** Human name of the folder/group the new item lands in, when it isn't the
   *  vault root — shown in the dialog title ("New folder in Work"). */
  targetLabel?: string;
}

/** Where a new folder should land: the vault root, inside another folder, or at
 *  the root but assigned to a folder group. */
export interface FolderTarget {
  /** Parent folder path (`""` = vault root). */
  parent: string;
  /** Group to assign the new (top-level) folder to, if any. */
  groupId?: string;
  /** Display name of the parent/group, for the dialog title. */
  label?: string;
}

export interface CreationDialogs {
  /** Open the new-folder dialog (fresh, empty name) for `target` — the vault
   *  root when omitted. */
  onNewFolder: (target?: FolderTarget) => void;
  /** Open the new-group dialog (fresh, empty name). */
  onNewGroup: () => void;
  newFolder: CreationDialog;
  newGroup: CreationDialog;
}

/**
 * State + handlers for the two sidebar "create" dialogs. A folder is created
 * wherever the nav tree's context menu pointed — the vault root, inside a
 * clicked folder, or at the root and assigned to a clicked group (a group can
 * only hold top-level folders). Groups themselves always start empty. The
 * returned `newFolder` / `newGroup` bundles are spread straight into the dialog
 * components, while `onNewFolder`/`onNewGroup` open them.
 */
export function useCreationDialogs({ refreshTree, setError }: Params): CreationDialogs {
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderTarget, setFolderTarget] = useState<FolderTarget>({ parent: "" });
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  const onNewFolder = useCallback((target?: FolderTarget) => {
    setFolderTarget(target ?? { parent: "" });
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
    const { parent, groupId } = folderTarget;
    try {
      const path = parent ? `${parent}/${name}` : name;
      await folders.create(path);
      // A group holds top-level folders, so "new folder in group" is a root
      // folder plus a membership assignment.
      if (groupId) await useFolderGroups.getState().assign(path, groupId);
      await refreshTree();
      // Reveal the new folder: its parent has to be expanded to be visible.
      if (parent) {
        const { expandedFolders, toggleFolder } = useViewState.getState();
        if (!expandedFolders.has(parent)) toggleFolder(parent);
      }
      setNewFolderOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [newFolderName, folderTarget, refreshTree, setError]);

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
      targetLabel: folderTarget.label,
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
