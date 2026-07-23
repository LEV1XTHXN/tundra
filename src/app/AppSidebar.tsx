import type { TreeNode, VaultInfo } from "@/services";
import { NavTree } from "@/nav/NavTree";
import { useViewState } from "@/store/viewState";
import { VaultSwitcher } from "./VaultSwitcher";
import type { NoteActions } from "./hooks/useNoteActions";
import type { Deletion } from "./hooks/useDeletion";
import type { CreationDialogs } from "./hooks/useCreationDialogs";

interface AppSidebarProps {
  vaultInfo: VaultInfo;
  treeData: TreeNode[];
  noteActions: NoteActions;
  deletion: Deletion;
  creation: CreationDialogs;
  /** Switch to a different (known, opened-elsewhere, or brand-new) vault —
   *  from `useVaultSession`; the vault-name switcher's only entry point. */
  onSwitchVault: (path: string) => Promise<void>;
  onError: (message: string) => void;
}

/**
 * The tree panel, between the icon ribbon and the main pane: the vault name
 * (which doubles as the vault switcher) and the folder/note tree, nothing else.
 * Creating, renaming and deleting all happen on the tree's right-click menu, so
 * this panel carries no buttons of its own.
 *
 * Nav *view* state (open note, expanded folders) is read straight from
 * `useViewState`; the mutation callbacks come from the action hooks via props.
 */
export function AppSidebar({
  vaultInfo,
  treeData,
  noteActions,
  deletion,
  creation,
  onSwitchVault,
  onError,
}: AppSidebarProps) {
  const openNoteId = useViewState((s) => s.openNoteId);
  const expandedFolders = useViewState((s) => s.expandedFolders);
  const toggleFolder = useViewState((s) => s.toggleFolder);
  const openNote = useViewState((s) => s.openNote);
  const openFolder = useViewState((s) => s.openFolder);

  return (
    <aside className="sidebar">
      <VaultSwitcher vaultInfo={vaultInfo} onSwitch={onSwitchVault} onError={onError} />
      <NavTree
        tree={treeData}
        vaultPath={vaultInfo.path}
        openNoteId={openNoteId}
        expandedFolders={expandedFolders}
        onToggleFolder={toggleFolder}
        onSelectNote={openNote}
        onOpenFolder={openFolder}
        onMoveNote={noteActions.onMoveNote}
        onMoveFolder={noteActions.onMoveFolder}
        onRenameNote={noteActions.onRenameNote}
        onRenameFolder={noteActions.onRenameFolder}
        onRequestDeleteNote={deletion.onRequestDeleteNote}
        onRequestDeleteFolder={deletion.onRequestDeleteFolder}
        onSetNoteIcon={noteActions.onSetNoteIcon}
        onRequestDeleteGroup={deletion.onRequestDeleteGroup}
        onNewNote={(folder) => void noteActions.onNewNote(folder)}
        onNewFolder={(parent, label) => creation.onNewFolder({ parent, label })}
        onNewFolderInGroup={(groupId, label) =>
          creation.onNewFolder({ parent: "", groupId, label })
        }
        onNewGroup={creation.onNewGroup}
      />
    </aside>
  );
}
