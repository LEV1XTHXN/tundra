import type { NoteSummary } from "@/services";
import { NoteEditor } from "@/editor/NoteEditor";
import { NoteInspector } from "@/inspector/NoteInspector";
import { TopBar } from "./TopBar";
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
 * the right-hand note-metadata inspector (backlinks, stats…). The editor's
 * `key` includes `editorRefreshToken` so an external rename/icon change remounts
 * it and reloads from disk. Reads the open note + inspector state from
 * `useViewState`.
 *
 * The breadcrumb and the note's action buttons are contributed to the shell's
 * top bar from inside the editor (`editor/EditorHeader.tsx`), which is where
 * their handlers live; the inspector's own toggle is shell chrome and lives in
 * `TopBar.tsx`.
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

  if (!openNoteId) {
    return (
      <>
        <TopBar title="Notes" />
        <div className="centered muted">Select or create a note.</div>
      </>
    );
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
