import type { TreeNode, VaultInfo } from "@/services";
import { NavTree } from "@/nav/NavTree";
import { SidebarSections } from "@/nav/SidebarSections";
import { useViewState } from "@/store/viewState";
import { ViewSwitcher } from "./ViewSwitcher";
import { SidebarActions } from "./SidebarActions";
import type { NoteActions } from "./hooks/useNoteActions";
import type { Deletion } from "./hooks/useDeletion";
import type { CreationDialogs } from "./hooks/useCreationDialogs";
import type { TemplateActions } from "./hooks/useTemplateActions";

interface AppSidebarProps {
  vaultInfo: VaultInfo;
  treeData: TreeNode[];
  noteActions: NoteActions;
  deletion: Deletion;
  creation: CreationDialogs;
  templateActions: TemplateActions;
  onSearch: () => void;
  onSettings: () => void;
}

/**
 * The app frame's left sidebar: vault name, view switcher, action buttons, the
 * nav tree (notes + folders), and the Templates section below a divider. Nav
 * *view* state (open note, expanded folders, active view) is read straight from
 * `useViewState`; the mutation callbacks come from the action hooks via props.
 */
export function AppSidebar({
  vaultInfo,
  treeData,
  noteActions,
  deletion,
  creation,
  templateActions,
  onSearch,
  onSettings,
}: AppSidebarProps) {
  const openNoteId = useViewState((s) => s.openNoteId);
  const expandedFolders = useViewState((s) => s.expandedFolders);
  const toggleFolder = useViewState((s) => s.toggleFolder);
  const openNote = useViewState((s) => s.openNote);
  const openFolder = useViewState((s) => s.openFolder);
  const view = useViewState((s) => s.view);
  const templateEditId = useViewState((s) => s.templateEditId);

  return (
    <aside className="sidebar">
      <div className="vault-name" title={vaultInfo.path}>
        {vaultInfo.name}
      </div>
      <ViewSwitcher />
      <SidebarActions
        onSearch={onSearch}
        onNewNote={() => void noteActions.onNewNote()}
        onNewFolder={creation.onNewFolder}
        onNewGroup={creation.onNewGroup}
        onSettings={onSettings}
      />
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
      />
      {/* Templates live at the bottom of the sidebar, below the vault tree,
          separated by a divider. */}
      <div className="sidebar-divider" />
      <SidebarSections
        vaultPath={vaultInfo.path}
        activeTemplateId={view === "template" ? templateEditId : null}
        onOpenTemplate={templateActions.onOpenTemplate}
        onNewTemplate={() => void templateActions.onNewTemplate()}
        onRequestDeleteTemplate={deletion.onRequestDeleteTemplate}
      />
    </aside>
  );
}
