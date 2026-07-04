/**
 * Phase 1 step 6: organizing actions on top of the step-5 tree — move (native
 * HTML5 drag-and-drop), inline rename, and delete (in-app confirmation, not
 * window.confirm). React only renders and dispatches user actions; every bit
 * of data flows through the `services` layer.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { folders, notes, pickVaultFolder, tree as fetchTree, vault, watcher } from "./services";
import type { CoreError, Icon, NoteSummary, TreeNode, VaultInfo } from "./services";
import { NoteEditor } from "./editor/NoteEditor";
import { NavTree } from "./nav/NavTree";
import { folderOfNotePath } from "./nav/flatten";
import { SearchPalette } from "./search/SearchPalette";
import { useViewState, type AppView } from "./store/viewState";

// The graph pulls in sigma + graphology (WebGL); code-split it so those only
// load when the user actually opens the graph view (Phase 2 step 4: "views
// mount lazily").
const GraphView = lazy(() => import("./graph/GraphView").then((m) => ({ default: m.GraphView })));

/** The top-level views reachable from the shell switcher, in display order. */
const VIEWS: { id: AppView; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "editor", label: "Notes" },
  { id: "graph", label: "Graph" },
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
  const [searchOpen, setSearchOpen] = useState(false);
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

  const refreshTree = useCallback(async () => {
    const [t, list] = await Promise.all([fetchTree(), notes.list()]);
    setTreeData(t);
    setNoteSummaries(new Map(list.map((n) => [n.id, n])));
    return list;
  }, []);

  // The folder the currently open note lives in — "new note" targets this
  // folder, falling back to the vault root when nothing is open.
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

  // Phase 1 step 9: Ctrl+K / Cmd+K opens the search palette, from anywhere.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
      const note = await notes.createIn("Untitled", selectedFolder);
      await refreshTree();
      openNote(note.id);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [selectedFolder, refreshTree, openNote]);

  const onNewFolder = useCallback(async () => {
    const name = window.prompt("New folder name")?.trim();
    if (!name) return;
    try {
      const path = selectedFolder ? `${selectedFolder}/${name}` : name;
      await folders.create(path);
      await refreshTree();
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [selectedFolder, refreshTree]);

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
            Search… <span className="muted">Ctrl+K</span>
          </button>
          <button className="new-note" onClick={onNewNote}>
            + New note
          </button>
          <button className="new-note" onClick={onNewFolder}>
            + New folder
          </button>
        </div>
        <NavTree
          tree={treeData}
          vaultPath={vaultInfo.path}
          openNoteId={openNoteId}
          expandedFolders={expandedFolders}
          onToggleFolder={toggleFolder}
          onSelectNote={openNote}
          onMoveNote={onMoveNote}
          onMoveFolder={onMoveFolder}
          onRenameNote={onRenameNote}
          onRenameFolder={onRenameFolder}
          onRequestDeleteNote={onRequestDeleteNote}
          onRequestDeleteFolder={onRequestDeleteFolder}
          onSetNoteIcon={onSetNoteIcon}
        />
      </aside>

      <main className="main-pane">
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

        {/* Quick notes (step 5) and Home (step 6) are placeholders for now. */}
        {view === "quicknotes" && (
          <div className="centered muted">Quick notes — coming in the next step.</div>
        )}
        {view === "home" && <div className="centered muted">Home dashboard — coming soon.</div>}
      </main>

      {error && <div className="error toast">{error}</div>}

      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} onSelectNote={openNote} />

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
    </div>
  );
}
