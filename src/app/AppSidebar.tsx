import { Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { TreeNode, VaultInfo } from "@/services";
import { NavTree } from "@/nav/NavTree";
import { CalendarSidebar } from "@/calendar/CalendarSidebar";
import { SettingsRail } from "@/settings/SettingsRail";
import { useViewState } from "@/store/viewState";
import { useWorkspace } from "@/store/workspace";
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
  /** Open the search palette — the sidebar's search field is a shortcut to the
   *  same overlay the ribbon and ⌘K already open, not a second search UI. */
  onSearch: () => void;
  /** Switch to a different (known, opened-elsewhere, or brand-new) vault —
   *  from `useVaultSession`; the vault-name switcher's only entry point. */
  onSwitchVault: (path: string) => Promise<void>;
  /** Delete a vault — its folder goes to the OS trash. Also from
   *  `useVaultSession`, which handles the "you just deleted the open vault"
   *  case by dropping the app back to onboarding. */
  onDeleteVault: (path: string) => Promise<void>;
  onError: (message: string) => void;
}

/**
 * The tree panel, between the icon ribbon and the main pane: the vault name
 * (which doubles as the vault switcher), a search field, the folder/note tree,
 * and a new-note row pinned to the bottom.
 *
 * The search field is a button wearing an input's clothes — there is one search
 * surface (the ⌘K palette) and this is a third door into it, so it deliberately
 * has no text box of its own to get out of sync. Renaming, moving and deleting
 * still live on the tree's right-click menu.
 *
 * Two views swap the tree for something of their own: the Calendar for a mini
 * month (`CalendarSidebar`) — a calendar is navigated by date, not by note —
 * and Settings for its section rail (`SettingsRail`). Every other view keeps
 * the tree, or hides the column entirely (see `store/theme.ts`).
 *
 * Nav *view* state (open note) is read straight from `useViewState`, and the
 * expanded folders from `useWorkspace` (which persists them per vault, so the
 * tree looks the same after a relaunch); the mutation callbacks come from the
 * action hooks via props.
 */
export function AppSidebar({
  vaultInfo,
  treeData,
  noteActions,
  deletion,
  creation,
  onSearch,
  onSwitchVault,
  onDeleteVault,
  onError,
}: AppSidebarProps) {
  const { t } = useTranslation();
  const view = useViewState((s) => s.view);
  const openNoteId = useViewState((s) => s.openNoteId);
  const expandedFolders = useWorkspace((s) => s.expandedFolders);
  const toggleFolder = useWorkspace((s) => s.toggleFolder);
  const openNote = useViewState((s) => s.openNote);
  const openFolder = useViewState((s) => s.openFolder);

  return (
    <aside className="sidebar">
      <VaultSwitcher
        vaultInfo={vaultInfo}
        onSwitch={onSwitchVault}
        onDelete={onDeleteVault}
        onError={onError}
      />
      {view === "calendar" ? (
        <CalendarSidebar />
      ) : view === "settings" ? (
        <SettingsRail />
      ) : (
        <>
          <button className="sidebar-search" onClick={onSearch}>
            <Search className="h-[15px] w-[15px]" />
            <span className="sidebar-search-label">{t("ribbon.search")}</span>
            <kbd className="sidebar-search-kbd">⌘K</kbd>
          </button>
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
          <button className="sidebar-new-note" onClick={() => void noteActions.onNewNote()}>
            <Plus className="h-4 w-4" />
            {t("nav.newNote")}
          </button>
        </>
      )}
    </aside>
  );
}
