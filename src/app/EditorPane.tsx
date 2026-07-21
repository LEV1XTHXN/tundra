import { PanelRight } from "lucide-react";
import type { NoteSummary } from "@/services";
import { NoteEditor } from "@/editor/NoteEditor";
import { NoteInspector } from "@/inspector/NoteInspector";
import { useViewState } from "@/store/viewState";

interface EditorPaneProps {
  vaultPath: string;
  noteSummaries: Map<string, NoteSummary>;
  editorRefreshToken: number;
  refreshTree: () => Promise<unknown>;
  setError: (msg: string | null) => void;
  bumpEditor: () => void;
}

/**
 * The Notes view: the block editor for the open note (or a placeholder), plus
 * the collapsible right-hand note-metadata inspector (backlinks, stats…). The
 * editor's `key` includes `editorRefreshToken` so an external rename/icon change
 * remounts it and reloads from disk. Reads the open note + inspector state from
 * `useViewState`.
 */
export function EditorPane({
  vaultPath,
  noteSummaries,
  editorRefreshToken,
  refreshTree,
  setError,
  bumpEditor,
}: EditorPaneProps) {
  const openNoteId = useViewState((s) => s.openNoteId);
  const inspectorOpen = useViewState((s) => s.inspectorOpen);
  const setInspectorOpen = useViewState((s) => s.setInspectorOpen);
  const toggleInspector = useViewState((s) => s.toggleInspector);

  if (!openNoteId) {
    return <div className="centered muted">Select or create a note.</div>;
  }

  return (
    <>
      <NoteEditor
        key={`${openNoteId}:${editorRefreshToken}`}
        noteId={openNoteId}
        vaultPath={vaultPath}
        noteSummaries={noteSummaries}
        onError={setError}
        onSaved={refreshTree}
        onNeedsReload={bumpEditor}
      />
      {/* Note-metadata inspector — a collapsible right drawer. Slides off-screen
          when closed. */}
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
        vaultPath={vaultPath}
        refreshKey={noteSummaries}
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
      />
    </>
  );
}
