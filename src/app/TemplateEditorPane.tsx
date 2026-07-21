import { ChevronLeft } from "lucide-react";
import type { NoteSummary } from "@/services";
import { NoteEditor, TEMPLATE_PERSISTENCE } from "@/editor/NoteEditor";

interface TemplateEditorPaneProps {
  templateEditId: string;
  vaultPath: string;
  noteSummaries: Map<string, NoteSummary>;
  onDone: () => void;
  setError: (msg: string | null) => void;
}

/**
 * Editing a template in the main pane (template mode of the block editor). A
 * template is authored like a note but never appears in notes/search/graph — the
 * top bar makes that explicit and returns to wherever editing was launched from.
 */
export function TemplateEditorPane({
  templateEditId,
  vaultPath,
  noteSummaries,
  onDone,
  setError,
}: TemplateEditorPaneProps) {
  return (
    <div className="template-editor">
      <div className="template-editor-bar">
        <button className="template-editor-back" onClick={onDone}>
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
          vaultPath={vaultPath}
          noteSummaries={noteSummaries}
          onError={setError}
        />
      </div>
    </div>
  );
}
