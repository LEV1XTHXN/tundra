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
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const templates = useTemplates((s) => s.list);

  return (
    <ViewFrame
      title={t("templates.title")}
      subtitle={t("templates.count", { count: templates.length })}
      actions={
        <button className="view-action" onClick={onNewTemplate}>
          <FilePlus className="h-4 w-4" /> {t("templates.newTemplate")}
        </button>
      }
    >
      {templates.length === 0 ? (
        <p className="muted">{t("templates.empty")}</p>
      ) : (
        <ul className="template-list">
          {templates.map((tpl) => (
            <li key={tpl.id}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <button className="template-card" onClick={() => onOpenTemplate(tpl.id)}>
                    <NoteIcon icon={tpl.icon} vaultPath={vaultPath} className="h-5 w-5 shrink-0" />
                    <span className="template-card-title">{tpl.title || t("templates.untitled")}</span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => onOpenTemplate(tpl.id)}>{t("templates.edit")}</ContextMenuItem>
                  <ContextMenuItem
                    variant="destructive"
                    onSelect={() => onRequestDeleteTemplate(tpl.id, tpl.title)}
                  >
                    <Trash2 /> {t("common.delete")}
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
