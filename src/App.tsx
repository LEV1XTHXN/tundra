/**
 * Phase 1 step 6: organizing actions on top of the step-5 tree — move (native
 * HTML5 drag-and-drop), inline rename, and delete (in-app confirmation, not
 * window.confirm). React only renders and dispatches user actions; every bit
 * of data flows through the `services` layer.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  FileText,
  Home as HomeIcon,
  Kanban as KanbanIcon,
  Network,
  NotebookPen,
  PanelRight,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { folders, notes, pickVaultFolder, tree as fetchTree, vault, watcher } from "./services";
import type { CoreError, Icon, NoteSummary, TreeNode, VaultInfo } from "./services";
import { NoteEditor, TEMPLATE_PERSISTENCE } from "./editor/NoteEditor";
import { NavTree } from "./nav/NavTree";
import { SidebarSections } from "./nav/SidebarSections";
import { templates as templatesService } from "./services";
import { useTemplates } from "./store/templates";
import { useFolderGroups } from "./store/folderGroups";
import { SearchPalette } from "./search/SearchPalette";
import { NoteInspector } from "./inspector/NoteInspector";
import { QuickNoteView } from "./quicknotes/QuickNoteView";
import { Home } from "./home/Home";
import { ViewFrame } from "./components/ViewFrame";
import { useViewState, type AppView } from "./store/viewState";
import { useKeybindings } from "./store/keybindings";
import { useTheme } from "./store/theme";
import { useActivity } from "./store/activity";
import { useTagColors, useKanbanTags, useVaultTags } from "./store/tagColors";
import { useFolderViews } from "./store/folderViews";
import { matchCommand, formatBinding } from "./keybindings/binding";
import { SettingsDialog } from "./settings/SettingsDialog";

// The graph pulls in sigma + graphology (WebGL); code-split it so those only
// load when the user actually opens the graph view (Phase 2 step 4: "views
// mount lazily").
const GraphView = lazy(() => import("./graph/GraphView").then((m) => ({ default: m.GraphView })));
// Calendar pulls in date-fns + its own view; code-split it like the graph so it
// only loads when the user opens the calendar (Phase 3 step 2: "mount lazily").
const CalendarView = lazy(() =>
  import("./calendar/CalendarView").then((m) => ({ default: m.CalendarView })),
);
// Kanban is its own view (like the calendar/graph) — code-split so its board +
// drag-and-drop machinery only load when the user opens it (Phase 3+).
const KanbanView = lazy(() =>
  import("./kanban/KanbanView").then((m) => ({ default: m.KanbanView })),
);
// The folder "database" table view — opened by clicking a folder in the sidebar.
// Code-split like the other non-editor views so its table machinery loads on demand.
const FolderTableView = lazy(() =>
  import("./foldertable/FolderTableView").then((m) => ({ default: m.FolderTableView })),
);

/** The top-level views reachable from the shell switcher, in display order. */
const VIEWS: { id: AppView; label: string; icon: LucideIcon }[] = [
  { id: "home", label: "Home", icon: HomeIcon },
  { id: "editor", label: "Notes", icon: FileText },
  { id: "graph", label: "Graph", icon: Network },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "kanban", label: "Kanban", icon: KanbanIcon },
  { id: "quicknotes", label: "Quick", icon: NotebookPen },
];
import { useLinkTitles } from "./store/linkTitles";
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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

function errorMessage(err: unknown): string {
  const e = err as Partial<CoreError>;
  if (e && typeof e === "object" && "kind" in e) {
    // Not every CoreError variant carries a `message` (e.g. EmptyBlockId doesn't).
    const m = "message" in e ? (e as { message?: unknown }).message : undefined;
    return typeof m === "string" ? `${e.kind}: ${m}` : String(e.kind);
  }
  return String(err);
}

type PendingDelete =
  | { kind: "note"; id: string; title: string }
  | { kind: "folder"; path: string; name: string; hasChildren: boolean }
  | { kind: "template"; id: string; title: string }
  | { kind: "group"; id: string; name: string };

export default function App() {
  const [vaultInfo, setVaultInfo] = useState<VaultInfo | null>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [noteSummaries, setNoteSummaries] = useState<Map<string, NoteSummary>>(new Map());
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Merged keybindings (defaults + persisted overrides) drive both the global
  // shortcut dispatcher and the sidebar hint, so a rebind takes effect live.
  const bindings = useKeybindings((s) => s.bindings);
  // Bumped when the open note is renamed from the tree, forcing NoteEditor to
  // remount and reload — it caches title locally, so an external rename
  // wouldn't otherwise be reflected until the user edited the title again
  // (which would silently revert it back).
  const [editorRefreshToken, setEditorRefreshToken] = useState(0);

  // View state only (Phase 1 preamble): open note id + expanded folder set.
  // Note content itself never lives here — it stays in NoteEditor's own state.
  const openNoteId = useViewState((s) => s.openNoteId);
  const setOpenNoteId = useViewState((s) => s.setOpenNoteId);
  const expandedFolders = useViewState((s) => s.expandedFolders);
  const toggleFolder = useViewState((s) => s.toggleFolder);
  const view = useViewState((s) => s.view);
  const setView = useViewState((s) => s.setView);
  // Opening a note always lands in the editor view, wherever it was triggered
  // from (nav click, search, new-note, graph click).
  const openNote = useViewState((s) => s.openNote);
  const openFolder = useViewState((s) => s.openFolder);
  const folderViewPath = useViewState((s) => s.folderViewPath);
  const openTemplate = useViewState((s) => s.openTemplate);
  const templateEditId = useViewState((s) => s.templateEditId);
  const inspectorOpen = useViewState((s) => s.inspectorOpen);
  const toggleInspector = useViewState((s) => s.toggleInspector);
  const setInspectorOpen = useViewState((s) => s.setInspectorOpen);
  const toggleGraphInspector = useViewState((s) => s.toggleGraphInspector);

  const refreshTree = useCallback(async () => {
    const [t, list] = await Promise.all([fetchTree(), notes.list()]);
    setTreeData(t);
    setNoteSummaries(new Map(list.map((n) => [n.id, n])));
    return list;
  }, []);

  // On launch, reopen the last vault so returning users skip onboarding.
  // Guarded against React StrictMode's dev-only double-invocation of effects:
  // without this, two concurrent `open_vault` calls race to construct the
  // Tantivy search index for the same directory and one fails with LockBusy.
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    (async () => {
      try {
        const last = await vault.last();
        if (last) {
          const info = await vault.open(last);
          setVaultInfo(info);
          await refreshTree();
        }
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBooting(false);
      }
    })();
  }, [refreshTree]);

  // Phase 1 step 8: the Rust file watcher emits this when the tree changed on
  // disk for a reason other than our own writes (self-writes are filtered
  // before it ever reaches here) — refresh the nav tree to match.
  useEffect(() => watcher.onTreeChanged(() => void refreshTree()), [refreshTree]);

  // Phase 2 step 3: keep the live id→title map current so note links always
  // render the target's CURRENT title (a rename updates every link's label).
  useEffect(() => {
    const titles: Record<string, string> = {};
    noteSummaries.forEach((s, id) => {
      titles[id] = s.title;
    });
    useLinkTitles.getState().setTitles(titles);
  }, [noteSummaries]);

  // Load the persisted keybinding overrides once on boot (before any shortcut
  // can fire). Independent of the vault — preferences are app-scoped.
  useEffect(() => {
    void useKeybindings.getState().load();
  }, []);

  // Load + apply the persisted theme (Phase 3 step 6) once on boot. App-scoped
  // (not vault-scoped); toggles the `.dark` class on <html>.
  useEffect(() => {
    void useTheme.getState().load();
  }, []);

  // Load the persisted usage streak once on boot (Home dashboard's Streak
  // widget). App-scoped, like keybindings/theme — see store/activity.ts.
  useEffect(() => {
    void useActivity.getState().load();
  }, []);

  // Load the vault's tag → color map whenever the open vault changes (Phase 3+).
  // Vault-scoped config, so it re-reads on switch rather than only on boot.
  useEffect(() => {
    if (vaultInfo) void useTagColors.getState().load();
  }, [vaultInfo]);

  // Load the set of Kanban-owned tags on vault change, so tag chips can render
  // Kanban tags distinctly (pastel + colored outline) even before the Kanban
  // view is opened. The Kanban view keeps this live as columns/tags change.
  useEffect(() => {
    if (vaultInfo) void useKanbanTags.getState().load();
  }, [vaultInfo]);

  // Load the full vault tag list on vault change — the pool for tag suggestions
  // and the settings tag manager. Kept live by tag mutations (add/rename/delete).
  useEffect(() => {
    if (vaultInfo) void useVaultTags.getState().load();
  }, [vaultInfo]);

  // Load the per-folder view config (sorting + table schema) on vault change —
  // same class of vault-scoped config as tag colors.
  useEffect(() => {
    if (vaultInfo) void useFolderViews.getState().load();
  }, [vaultInfo]);

  // Load the vault's template list on vault change, for the sidebar Templates
  // section + Settings manager (both read the shared store).
  useEffect(() => {
    if (vaultInfo) void useTemplates.getState().refresh();
  }, [vaultInfo]);

  // Load the vault's folder groups (collapsible sidebar sections) on vault change
  // — vault-scoped config, same as folder views.
  useEffect(() => {
    if (vaultInfo) void useFolderGroups.getState().load();
  }, [vaultInfo]);

  const openVaultAt = useCallback(
    async (path: string) => {
      setError(null);
      try {
        const info = await vault.open(path);
        setVaultInfo(info);
        await refreshTree();
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [refreshTree],
  );

  const onChooseFolder = useCallback(async () => {
    const path = await pickVaultFolder();
    if (path) await openVaultAt(path);
  }, [openVaultAt]);

  const onUseDefault = useCallback(async () => {
    try {
      await openVaultAt(await vault.defaultPath());
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [openVaultAt]);

  const onNewNote = useCallback(async () => {
    try {
      // Always the vault root — no default folder, regardless of what's
      // currently open (the user can move it into a folder afterward).
      const note = await notes.createIn("Untitled", "");
      await refreshTree();
      openNote(note.id);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [refreshTree, openNote]);

  const onNewFolder = useCallback(() => {
    setNewFolderName("");
    setNewFolderOpen(true);
  }, []);

  const createFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      // Always the vault root — no default parent, regardless of what's
      // currently open (matches onNewNote; drag the folder to nest it after).
      await folders.create(name);
      await refreshTree();
      setNewFolderOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [newFolderName, refreshTree]);

  // --- move / rename / delete (Phase 1 step 6) ---------------------------

  const onMoveNote = useCallback(
    async (id: string, folder: string) => {
      try {
        await notes.move(id, folder);
        await refreshTree();
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [refreshTree],
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
    [refreshTree],
  );

  const onRenameNote = useCallback(
    async (id: string, newTitle: string) => {
      try {
        const note = await notes.read(id);
        await notes.save({ ...note, title: newTitle });
        await refreshTree();
        if (id === openNoteId) setEditorRefreshToken((t) => t + 1);
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [openNoteId, refreshTree],
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
    [refreshTree],
  );

  const onSetNoteIcon = useCallback(
    async (id: string, icon: Icon | null) => {
      try {
        const note = await notes.read(id);
        await notes.save({ ...note, icon: icon ?? undefined });
        await refreshTree();
        if (id === openNoteId) setEditorRefreshToken((t) => t + 1);
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [openNoteId, refreshTree],
  );

  const onRequestDeleteNote = useCallback((id: string, title: string) => {
    setPendingDelete({ kind: "note", id, title });
  }, []);

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

  const onRequestDeleteFolder = useCallback((path: string, name: string, hasChildren: boolean) => {
    setPendingDelete({ kind: "folder", path, name, hasChildren });
  }, []);

  // Editing a template opens it in the main editor pane (template mode). We
  // remember where the user came from so "Done" returns there — and reopens the
  // Settings dialog only when the edit was launched from the Templates manager
  // (not from the sidebar Templates section).
  const templateReturn = useRef<{ view: AppView; settings: boolean }>({ view: "home", settings: false });
  const openTemplateForEdit = useCallback(
    (id: string, fromSettings: boolean) => {
      const current = useViewState.getState().view;
      templateReturn.current = { view: current === "template" ? "home" : current, settings: fromSettings };
      setSettingsOpen(false);
      openTemplate(id);
    },
    [openTemplate],
  );
  // Launched from the Settings ▸ Templates manager (returns to Settings on Done).
  const onEditTemplateFromSettings = useCallback(
    (id: string) => openTemplateForEdit(id, true),
    [openTemplateForEdit],
  );
  // Launched from the sidebar Templates section (returns to the prior view).
  const onOpenTemplate = useCallback(
    (id: string) => openTemplateForEdit(id, false),
    [openTemplateForEdit],
  );
  const onDoneEditingTemplate = useCallback(() => {
    setView(templateReturn.current.view);
    if (templateReturn.current.settings) setSettingsOpen(true);
    // A rename/edit may have changed the title — refresh the sidebar list.
    void useTemplates.getState().refresh();
  }, [setView]);

  const onNewTemplate = useCallback(async () => {
    try {
      const tpl = await templatesService.create("Untitled template");
      await useTemplates.getState().refresh();
      openTemplateForEdit(tpl.id, false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [openTemplateForEdit]);

  const onRequestDeleteTemplate = useCallback((id: string, title: string) => {
    setPendingDelete({ kind: "template", id, title });
  }, []);

  // Folder groups (collapsible sidebar sections). Create prompts for a name; the
  // group starts empty and folders are dragged in (or the group is filled later).
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const createGroup = useCallback(async () => {
    const name = newGroupName.trim();
    if (!name) return;
    try {
      await useFolderGroups.getState().create(name);
      setNewGroupOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [newGroupName]);
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
        if (templateEditId === id) setView(templateReturn.current.view);
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
  }, [pendingDelete, openNoteId, refreshTree, setOpenNoteId, templateEditId, setView]);

  // Global shortcut dispatcher (app-level commands). Editor-scoped commands
  // (find-in-note, note links) are handled inside NoteEditor; both listeners
  // share the same `matchCommand` matcher and act only on their own ids.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      switch (matchCommand(e, bindings)) {
        case "search.global":
          e.preventDefault();
          setSearchOpen((open) => !open);
          break;
        case "note.new":
          e.preventDefault();
          void onNewNote();
          break;
        case "view.quicknotes":
          e.preventDefault();
          setView("quicknotes");
          break;
        case "inspector.toggle":
          // Context-dependent: the note-metadata panel in the editor (needs an
          // open note), or the graph's info/settings panel in the graph view.
          if (view === "editor" && openNoteId) {
            e.preventDefault();
            toggleInspector();
          } else if (view === "graph") {
            e.preventDefault();
            toggleGraphInspector();
          }
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bindings, onNewNote, setView, view, openNoteId, toggleInspector, toggleGraphInspector]);

  if (booting) {
    return <div className="centered muted">Loading…</div>;
  }

  if (!vaultInfo) {
    return (
      <div className="centered onboarding">
        <h1>Tundra</h1>
        <p className="muted">Choose where your notes live.</p>
        <div className="actions">
          <button onClick={onChooseFolder}>Choose a folder…</button>
          <button className="primary" onClick={onUseDefault}>
            Use default vault
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="vault-name" title={vaultInfo.path}>
          {vaultInfo.name}
        </div>
        <nav className="view-switcher" role="tablist" aria-label="Views">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              className={`view-switcher-tab${view === v.id ? " active" : ""}`}
              onClick={() => setView(v.id)}
            >
              <v.icon className="h-4 w-4" />
              {v.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-actions">
          <button className="new-note" onClick={() => setSearchOpen(true)}>
            Search… <span className="muted">{formatBinding(bindings["search.global"])}</span>
          </button>
          <button className="new-note" onClick={onNewNote}>
            + New note
          </button>
          <button className="new-note" onClick={onNewFolder}>
            + New folder
          </button>
          <button
            className="new-note"
            onClick={() => {
              setNewGroupName("");
              setNewGroupOpen(true);
            }}
          >
            + New group
          </button>
          <button className="new-note settings-button" onClick={() => setSettingsOpen(true)}>
            <Settings className="h-4 w-4" /> Settings
          </button>
        </div>
        <NavTree
          tree={treeData}
          vaultPath={vaultInfo.path}
          openNoteId={openNoteId}
          expandedFolders={expandedFolders}
          onToggleFolder={toggleFolder}
          onSelectNote={openNote}
          onOpenFolder={openFolder}
          onMoveNote={onMoveNote}
          onMoveFolder={onMoveFolder}
          onRenameNote={onRenameNote}
          onRenameFolder={onRenameFolder}
          onRequestDeleteNote={onRequestDeleteNote}
          onRequestDeleteFolder={onRequestDeleteFolder}
          onSetNoteIcon={onSetNoteIcon}
          onRequestDeleteGroup={onRequestDeleteGroup}
        />
        {/* Templates live at the bottom of the sidebar, below the vault tree,
            separated by a divider. */}
        <div className="sidebar-divider" />
        <SidebarSections
          vaultPath={vaultInfo.path}
          activeTemplateId={view === "template" ? templateEditId : null}
          onOpenTemplate={onOpenTemplate}
          onNewTemplate={() => void onNewTemplate()}
          onRequestDeleteTemplate={onRequestDeleteTemplate}
        />
      </aside>

      <main className={`main-pane${view === "editor" && openNoteId && inspectorOpen ? " inspector-open" : ""}`}>
        {view === "editor" &&
          (openNoteId ? (
            <NoteEditor
              key={`${openNoteId}:${editorRefreshToken}`}
              noteId={openNoteId}
              vaultPath={vaultInfo.path}
              noteSummaries={noteSummaries}
              onError={setError}
              onSaved={refreshTree}
              onNeedsReload={() => setEditorRefreshToken((t) => t + 1)}
            />
          ) : (
            <div className="centered muted">Select or create a note.</div>
          ))}

        {view === "graph" && (
          <Suspense
            fallback={
              <ViewFrame title="Graph" fullBleed>
                <div className="centered muted">Loading graph…</div>
              </ViewFrame>
            }
          >
            <GraphView />
          </Suspense>
        )}

        {view === "calendar" && (
          <Suspense
            fallback={
              <ViewFrame title="Calendar" fullBleed>
                <div className="centered muted">Loading calendar…</div>
              </ViewFrame>
            }
          >
            <CalendarView onOpenNote={openNote} onError={setError} />
          </Suspense>
        )}

        {view === "kanban" && (
          <Suspense
            fallback={
              <ViewFrame title="Kanban" fullBleed>
                <div className="centered muted">Loading kanban…</div>
              </ViewFrame>
            }
          >
            <KanbanView vaultPath={vaultInfo.path} onOpenNote={openNote} onError={setError} />
          </Suspense>
        )}

        {view === "folder" && folderViewPath !== null && (
          <Suspense fallback={<div className="centered muted">Loading folder…</div>}>
            <FolderTableView
              key={folderViewPath}
              folderPath={folderViewPath}
              vaultName={vaultInfo.name}
              tree={treeData}
              vaultPath={vaultInfo.path}
              onOpenNote={openNote}
              onOpenFolder={openFolder}
              onError={(m) => setError(m)}
              onChanged={() => void refreshTree()}
            />
          </Suspense>
        )}

        {view === "template" && templateEditId && (
          <div className="template-editor">
            <div className="template-editor-bar">
              <button className="template-editor-back" onClick={onDoneEditingTemplate}>
                <ChevronLeft className="h-4 w-4" /> Done editing template
              </button>
              <span className="muted template-editor-hint">
                Editing a template — it won’t appear in your notes, search, or graph.
              </span>
            </div>
            <div className="template-editor-body">
              <NoteEditor
                key={`tpl:${templateEditId}`}
                noteId={templateEditId}
                persistence={TEMPLATE_PERSISTENCE}
                mode="template"
                vaultPath={vaultInfo.path}
                noteSummaries={noteSummaries}
                onError={setError}
              />
            </div>
          </div>
        )}

        {view === "quicknotes" && <QuickNoteView vaultPath={vaultInfo.path} onError={setError} />}

        {view === "home" && (
          <Home
            vaultPath={vaultInfo.path}
            refreshKey={noteSummaries}
            onOpenNote={openNote}
            onError={setError}
          />
        )}

        {/* Note-metadata inspector — a collapsible right drawer, only meaningful
            for an open note in the editor view. Slides off-screen when closed. */}
        {view === "editor" && openNoteId && (
          <>
            {!inspectorOpen && (
              <button
                className="inspector-toggle"
                onClick={toggleInspector}
                title="Note info"
                aria-label="Open note info panel"
              >
                <PanelRight className="h-4 w-4" />
              </button>
            )}
            <NoteInspector
              noteId={openNoteId}
              vaultPath={vaultInfo.path}
              refreshKey={noteSummaries}
              open={inspectorOpen}
              onClose={() => setInspectorOpen(false)}
            />
          </>
        )}
      </main>

      {error && <div className="error toast">{error}</div>}

      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} onSelectNote={openNote} />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onCleaned={onVaultCleaned}
        onEditTemplate={onEditTemplateFromSettings}
        onTagsChanged={() => void refreshTree()}
      />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete?.kind === "folder" || pendingDelete?.kind === "group"
                ? `Delete "${pendingDelete.name}"?`
                : `Delete "${pendingDelete?.title || (pendingDelete?.kind === "template" ? "Untitled template" : "Untitled")}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.kind === "note"
                ? "This note will be permanently deleted."
                : pendingDelete?.kind === "template"
                  ? "This template will be permanently deleted. Notes created from it are not affected."
                  : pendingDelete?.kind === "group"
                    ? "This group will be removed. The folders inside it are not deleted — they'll just no longer be grouped."
                    : pendingDelete?.hasChildren
                      ? "This folder and everything inside it — all notes and subfolders — will be permanently deleted."
                      : "This empty folder will be permanently deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createFolder();
            }}
          >
            <Input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
            />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setNewFolderOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!newFolderName.trim()}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={newGroupOpen} onOpenChange={setNewGroupOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New group</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createGroup();
            }}
          >
            <Input
              autoFocus
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Group name"
            />
            <p className="muted mt-2 text-sm">
              A group is a collapsible section in the sidebar. Drag top-level folders onto its
              header to add them.
            </p>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setNewGroupOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!newGroupName.trim()}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
