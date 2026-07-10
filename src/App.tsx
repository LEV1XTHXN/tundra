/**
 * Phase 1 step 6: organizing actions on top of the step-5 tree — move (native
 * HTML5 drag-and-drop), inline rename, and delete (in-app confirmation, not
 * window.confirm). React only renders and dispatches user actions; every bit
 * of data flows through the `services` layer.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelRight, Settings } from "lucide-react";
import { folders, notes, pickVaultFolder, tree as fetchTree, vault, watcher } from "./services";
import type { CoreError, Icon, NoteSummary, TreeNode, VaultInfo } from "./services";
import { NoteEditor } from "./editor/NoteEditor";
import { NavTree } from "./nav/NavTree";
import { folderOfNotePath } from "./nav/flatten";
import { SearchPalette } from "./search/SearchPalette";
import { NoteInspector } from "./inspector/NoteInspector";
import { QuickNoteView } from "./quicknotes/QuickNoteView";
import { Home } from "./home/Home";
import { useViewState, type AppView } from "./store/viewState";
import { useKeybindings } from "./store/keybindings";
import { useTheme } from "./store/theme";
import { useTagColors } from "./store/tagColors";
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
const VIEWS: { id: AppView; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "editor", label: "Notes" },
  { id: "graph", label: "Graph" },
  { id: "calendar", label: "Calendar" },
  { id: "kanban", label: "Kanban" },
  { id: "quicknotes", label: "Quick" },
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
  | { kind: "folder"; path: string; name: string; hasChildren: boolean };

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

  // The folder the currently open note lives in — "new folder" nests here,
  // falling back to the vault root when nothing is open. (New notes always
  // go to the vault root regardless — see onNewNote.)
  const selectedFolder = useMemo(() => {
    if (!openNoteId) return "";
    const summary = noteSummaries.get(openNoteId);
    return summary ? folderOfNotePath(summary.path) : "";
  }, [openNoteId, noteSummaries]);

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

  // Load the vault's tag → color map whenever the open vault changes (Phase 3+).
  // Vault-scoped config, so it re-reads on switch rather than only on boot.
  useEffect(() => {
    if (vaultInfo) void useTagColors.getState().load();
  }, [vaultInfo]);

  // Load the per-folder view config (sorting + table schema) on vault change —
  // same class of vault-scoped config as tag colors.
  useEffect(() => {
    if (vaultInfo) void useFolderViews.getState().load();
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
      const path = selectedFolder ? `${selectedFolder}/${name}` : name;
      await folders.create(path);
      await refreshTree();
      setNewFolderOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [newFolderName, selectedFolder, refreshTree]);

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

  // Flip a note's pinned flag from the nav tree (pinned notes float to the top
  // of the hierarchy). Goes through read+save like the editor's pin button —
  // there's no dedicated pin command; meta.pinned is mirrored into the summary.
  const onToggleNotePin = useCallback(
    async (id: string, pinned: boolean) => {
      try {
        const note = await notes.read(id);
        await notes.save({ ...note, meta: { ...note.meta, pinned: !pinned } });
        await refreshTree();
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [refreshTree],
  );

  const onRenameFolder = useCallback(
    async (path: string, newName: string) => {
      try {
        await folders.rename(path, newName);
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

  const onRequestDeleteFolder = useCallback((path: string, name: string, hasChildren: boolean) => {
    setPendingDelete({ kind: "folder", path, name, hasChildren });
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    try {
      if (pendingDelete.kind === "note") {
        await notes.delete(pendingDelete.id);
      } else {
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
  }, [pendingDelete, openNoteId, refreshTree, setOpenNoteId]);

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
        <div className="view-switcher" role="tablist" aria-label="Views">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              className={`view-switcher-tab${view === v.id ? " active" : ""}`}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
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
          onToggleNotePin={onToggleNotePin}
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
          <Suspense fallback={<div className="centered muted">Loading graph…</div>}>
            <GraphView />
          </Suspense>
        )}

        {view === "calendar" && (
          <Suspense fallback={<div className="centered muted">Loading calendar…</div>}>
            <CalendarView onOpenNote={openNote} onError={setError} />
          </Suspense>
        )}

        {view === "kanban" && (
          <Suspense fallback={<div className="centered muted">Loading kanban…</div>}>
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

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete?.kind === "note"
                ? `Delete "${pendingDelete.title || "Untitled"}"?`
                : `Delete "${pendingDelete?.name}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.kind === "note"
                ? "This note will be permanently deleted."
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
    </div>
  );
}
