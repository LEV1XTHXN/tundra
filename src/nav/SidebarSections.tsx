/**
 * The **Templates** sidebar section, shown ABOVE the folder/note tree: reusable
 * note templates (stored outside `notes/`, so they never appear in the tree).
 * Click to edit; "+" creates a new one.
 *
 * Kept out of the virtualized `NavTree` (whose drag-and-drop/flatten machinery is
 * note/folder-specific) — it's a small, flat, always-in-view list. React only
 * renders; all data flows through props / the `services`-backed templates store.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTemplates } from "@/store/templates";
import { NoteIcon } from "./NoteIcon";

interface SidebarSectionsProps {
  vaultPath: string;
  /** The template currently open in the editor (highlighted), if any. */
  activeTemplateId: string | null;
  onOpenTemplate: (id: string) => void;
  onNewTemplate: () => void;
  onRequestDeleteTemplate: (id: string, title: string) => void;
}

export function SidebarSections({
  vaultPath,
  activeTemplateId,
  onOpenTemplate,
  onNewTemplate,
  onRequestDeleteTemplate,
}: SidebarSectionsProps) {
  const templates = useTemplates((s) => s.list);

  return (
    <div className="sidebar-sections">
      <Section
        title="Templates"
        count={templates.length}
        defaultOpen
        action={
          <button
            className="sidebar-section-action"
            title="New template"
            aria-label="New template"
            onClick={onNewTemplate}
          >
            <Plus size={14} />
          </button>
        }
      >
        {templates.length === 0 ? (
          <p className="muted sidebar-section-empty">No templates yet</p>
        ) : (
          templates.map((t) => (
            <div className="sidebar-section-row-wrap" key={t.id}>
              <button
                className={cn("sidebar-section-row", t.id === activeTemplateId && "active")}
                onClick={() => onOpenTemplate(t.id)}
              >
                <NoteIcon icon={t.icon} vaultPath={vaultPath} className="h-4 w-4 shrink-0" />
                <span className="nav-row-label">{t.title || "Untitled template"}</span>
              </button>
              <div className="sidebar-section-row-actions">
                <button
                  className="nav-row-action"
                  title="Delete template"
                  aria-label={`Delete ${t.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRequestDeleteTemplate(t.id, t.title);
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  count,
  action,
  defaultOpen,
  children,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  return (
    <div className="sidebar-section">
      <div className="sidebar-section-header">
        <button className="sidebar-section-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="sidebar-section-heading">{title}</span>
          {count != null && <span className="sidebar-section-count">{count}</span>}
        </button>
        {action}
      </div>
      {open && <div className="sidebar-section-body">{children}</div>}
    </div>
  );
}
