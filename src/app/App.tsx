/**
 * Composition root for the app shell. Holds no business logic and almost no
 * JSX of its own — it wires the orchestration hooks (vault session, tree, store
 * loading, note/template/deletion actions, global shortcuts) to the shell
 * components (sidebar, main pane, dialogs). Every bit of data still flows through
 * the `services` layer; React only renders and dispatches (CLAUDE.md §2).
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import { SearchPalette } from "@/search/SearchPalette";
import { SettingsDialog } from "@/settings/SettingsDialog";
import { ImportDialog } from "@/import/ImportDialog";
import { useViewState } from "@/store/viewState";
import { useTheme } from "@/store/theme";
import { Onboarding } from "./Onboarding";
import { Ribbon } from "./Ribbon";
import { AppSidebar } from "./AppSidebar";
import { MainPane } from "./MainPane";
import { ErrorToast } from "./ErrorToast";
import { DeleteConfirmDialog } from "./dialogs/DeleteConfirmDialog";
import { NewFolderDialog } from "./dialogs/NewFolderDialog";
import { NewGroupDialog } from "./dialogs/NewGroupDialog";
import { useVaultTree } from "./hooks/useVaultTree";
import { useVaultSession } from "./hooks/useVaultSession";
import { useAppStores } from "./hooks/useAppStores";
import { useEditorRefresh } from "./hooks/useEditorRefresh";
import { useNoteActions } from "./hooks/useNoteActions";
import { useCreationDialogs } from "./hooks/useCreationDialogs";
import { useTemplateActions } from "./hooks/useTemplateActions";
import { useDeletion } from "./hooks/useDeletion";
import { useAppShortcuts } from "./hooks/useAppShortcuts";

export default function App() {
  const { treeData, noteSummaries, refreshTree } = useVaultTree();
  const { vaultInfo, booting, error, setError, onChooseFolder, onUseDefault, switchVault } =
    useVaultSession(refreshTree);
  useAppStores(vaultInfo);

  const openNote = useViewState((s) => s.openNote);
  // The ribbon's width is a grid track on `.app`, so the shell owns the class
  // that widens it when the ribbon is slid open.
  const ribbonExpanded = useTheme((s) => s.ribbonExpanded);
  const [editorRefreshToken, bumpEditor] = useEditorRefresh();
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const noteActions = useNoteActions({ refreshTree, setError, bumpEditor });
  const creation = useCreationDialogs({ refreshTree, setError });
  const templateActions = useTemplateActions({ setError });
  const deletion = useDeletion({
    refreshTree,
    setError,
    returnFromTemplate: templateActions.returnFromTemplate,
  });
  useAppShortcuts({ onNewNote: () => void noteActions.onNewNote(), setSearchOpen });

  if (booting) {
    return <div className="centered muted">Loading…</div>;
  }

  if (!vaultInfo) {
    return <Onboarding onChooseFolder={onChooseFolder} onUseDefault={onUseDefault} error={error} />;
  }

  return (
    <div className={cn("app", ribbonExpanded && "ribbon-open")}>
      <Ribbon onSearch={() => setSearchOpen(true)} onSettings={() => setSettingsOpen(true)} />

      <AppSidebar
        vaultInfo={vaultInfo}
        treeData={treeData}
        noteActions={noteActions}
        deletion={deletion}
        creation={creation}
        onSwitchVault={switchVault}
        onError={setError}
      />

      <MainPane
        vaultInfo={vaultInfo}
        treeData={treeData}
        noteSummaries={noteSummaries}
        refreshTree={refreshTree}
        setError={setError}
        editorRefreshToken={editorRefreshToken}
        bumpEditor={bumpEditor}
        templateActions={templateActions}
        deletion={deletion}
      />

      <ErrorToast error={error} />

      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} onSelectNote={openNote} />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onCleaned={noteActions.onVaultCleaned}
        onOpenImport={() => {
          setSettingsOpen(false);
          setImportOpen(true);
        }}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onSwitchVault={switchVault}
        onImported={() => void refreshTree()}
      />

      <DeleteConfirmDialog
        pendingDelete={deletion.pendingDelete}
        onCancel={() => deletion.setPendingDelete(null)}
        onConfirm={() => void deletion.confirmDelete()}
      />

      <NewFolderDialog {...creation.newFolder} />
      <NewGroupDialog {...creation.newGroup} />
    </div>
  );
}
