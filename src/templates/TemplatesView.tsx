/**
 * The **Templates** view — reusable note templates (stored outside `notes/`, so
 * they never appear in the note tree). A ribbon destination of its own, replacing
 * the old sidebar section: clicking a template opens it in the editor's template
 * mode, and its right-click menu deletes it.
 *
 * Reads the list from the `services`-backed templates store; every mutation is
 * dispatched through the callbacks the shell passes in (React renders, the core
 * decides — CLAUDE.md §2).
 */
import { FilePlus, Trash2 } from "lucide-react";
import { ViewFrame } from "@/components/ViewFrame";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { NoteIcon } from "@/nav/NoteIcon";
import { useTemplates } from "@/store/templates";

interface TemplatesViewProps {
  vaultPath: string;
  onOpenTemplate: (id: string) => void;
  onNewTemplate: () => void;
  onRequestDeleteTemplate: (id: string, title: string) => void;
}

export function TemplatesView({
  vaultPath,
  onOpenTemplate,
  onNewTemplate,
  onRequestDeleteTemplate,
}: TemplatesViewProps) {
  const templates = useTemplates((s) => s.list);

  return (
    <ViewFrame
      title="Templates"
      subtitle={`${templates.length} ${templates.length === 1 ? "template" : "templates"}`}
      actions={
        <button className="view-action" onClick={onNewTemplate}>
          <FilePlus className="h-4 w-4" /> New template
        </button>
      }
    >
      {templates.length === 0 ? (
        <p className="muted">
          No templates yet. Create one here, or save any note as a template from its editor.
        </p>
      ) : (
        <ul className="template-list">
          {templates.map((t) => (
            <li key={t.id}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <button className="template-card" onClick={() => onOpenTemplate(t.id)}>
                    <NoteIcon icon={t.icon} vaultPath={vaultPath} className="h-5 w-5 shrink-0" />
                    <span className="template-card-title">{t.title || "Untitled template"}</span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => onOpenTemplate(t.id)}>Edit</ContextMenuItem>
                  <ContextMenuItem
                    variant="destructive"
                    onSelect={() => onRequestDeleteTemplate(t.id, t.title)}
                  >
                    <Trash2 /> Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </li>
          ))}
        </ul>
      )}
    </ViewFrame>
  );
}
