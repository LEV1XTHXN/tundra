import { lazy, Suspense } from "react";
import type { NoteSummary, TreeNode, VaultInfo } from "@/services";
import { ViewFrame } from "@/components/ViewFrame";
import { QuickNoteView } from "@/quicknotes/QuickNoteView";
import { Home } from "@/home/Home";
import { useViewState } from "@/store/viewState";
import { EditorPane } from "./EditorPane";
import { TemplateEditorPane } from "./TemplateEditorPane";

// The graph pulls in sigma + graphology (WebGL); code-split it so those only
// load when the user actually opens the graph view (Phase 2 step 4: "views
// mount lazily").
const GraphView = lazy(() => import("@/graph/GraphView").then((m) => ({ default: m.GraphView })));
// Calendar pulls in date-fns + its own view; code-split it like the graph so it
// only loads when the user opens the calendar (Phase 3 step 2: "mount lazily").
const CalendarView = lazy(() =>
  import("@/calendar/CalendarView").then((m) => ({ default: m.CalendarView })),
);
// Kanban is its own view (like the calendar/graph) — code-split so its board +
// drag-and-drop machinery only load when the user opens it (Phase 3+).
const KanbanView = lazy(() => import("@/kanban/KanbanView").then((m) => ({ default: m.KanbanView })));
// The folder "database" table view — opened by clicking a folder in the sidebar.
// Code-split like the other non-editor views so its table machinery loads on demand.
const FolderTableView = lazy(() =>
  import("@/foldertable/FolderTableView").then((m) => ({ default: m.FolderTableView })),
);

interface MainPaneProps {
  vaultInfo: VaultInfo;
  treeData: TreeNode[];
  noteSummaries: Map<string, NoteSummary>;
  refreshTree: () => Promise<unknown>;
  setError: (msg: string | null) => void;
  editorRefreshToken: number;
  bumpEditor: () => void;
  onDoneEditingTemplate: () => void;
}

/**
 * The app frame's main pane: routes the active view to its surface. Non-editor
 * views (graph/calendar/kanban/folder table) are code-split and mount lazily.
 * Reads the active view + its target ids from `useViewState`; receives the
 * vault/tree data and shared callbacks as props.
 */
export function MainPane({
  vaultInfo,
  treeData,
  noteSummaries,
  refreshTree,
  setError,
  editorRefreshToken,
  bumpEditor,
  onDoneEditingTemplate,
}: MainPaneProps) {
  const view = useViewState((s) => s.view);
  const openNoteId = useViewState((s) => s.openNoteId);
  const inspectorOpen = useViewState((s) => s.inspectorOpen);
  const folderViewPath = useViewState((s) => s.folderViewPath);
  const templateEditId = useViewState((s) => s.templateEditId);
  const openNote = useViewState((s) => s.openNote);
  const openFolder = useViewState((s) => s.openFolder);

  const inspectorClass =
    view === "editor" && openNoteId && inspectorOpen ? " inspector-open" : "";

  return (
    <main className={`main-pane${inspectorClass}`}>
      {view === "editor" && (
        <EditorPane
          vaultPath={vaultInfo.path}
          noteSummaries={noteSummaries}
          editorRefreshToken={editorRefreshToken}
          refreshTree={refreshTree}
          setError={setError}
          bumpEditor={bumpEditor}
        />
      )}

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
        <TemplateEditorPane
          templateEditId={templateEditId}
          vaultPath={vaultInfo.path}
          noteSummaries={noteSummaries}
          onDone={onDoneEditingTemplate}
          setError={setError}
        />
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
    </main>
  );
}
