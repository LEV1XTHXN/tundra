/**
 * Composition root for the app shell. Holds no business logic and almost no
 * JSX of its own — it wires the orchestration hooks (vault session, tree, store
 * loading, note/template/deletion actions, global shortcuts) to the shell
 * components (sidebar, main pane, dialogs). Every bit of data still flows through
 * the `services` layer; React only renders and dispatches (CLAUDE.md §2).
 */
import { useState } from "react";
import { SearchPalette } from "@/search/SearchPalette";
import { SettingsDialog } from "@/settings/SettingsDialog";
import { ImportDialog } from "@/import/ImportDialog";
import { useViewState } from "@/store/viewState";
import { Onboarding } from "./Onboarding";
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
  const [editorRefreshToken, bumpEditor] = useEditorRefresh();
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const noteActions = useNoteActions({ refreshTree, setError, bumpEditor });
  const creation = useCreationDialogs({ refreshTree, setError });
  const templateActions = useTemplateActions({ setSettingsOpen, setError });
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
    <div className="app">
      <AppSidebar
        vaultInfo={vaultInfo}
        treeData={treeData}
        noteActions={noteActions}
        deletion={deletion}
        creation={creation}
        templateActions={templateActions}
        onSearch={() => setSearchOpen(true)}
        onSettings={() => setSettingsOpen(true)}
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
        onDoneEditingTemplate={templateActions.onDoneEditingTemplate}
      />

      <ErrorToast error={error} />

      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} onSelectNote={openNote} />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onCleaned={noteActions.onVaultCleaned}
        onEditTemplate={templateActions.onEditTemplateFromSettings}
        onTagsChanged={() => void refreshTree()}
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
