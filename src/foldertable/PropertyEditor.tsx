import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { TAG_PALETTE, contrastText } from "@/store/tagColors";
import type { PropertyDef, SelectOption } from "@/store/folderViews";
import type { useFolderSchema } from "./useFolderSchema";

type Schema = ReturnType<typeof useFolderSchema>;

const TYPE_LABELS: Record<PropertyDef["type"], string> = {
  text: "Text",
  number: "Number",
  select: "Select",
  multiSelect: "Multi-select",
  date: "Date",
};

interface PropertyEditorProps {
  def: PropertyDef;
  schema: Schema;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Edit an existing property: rename it and, for select/multi-select, manage its
 * options (add, rename, recolor, remove). The type is fixed after creation —
 * changing it would orphan existing note values — so it's shown read-only.
 */
export function PropertyEditor({ def, schema, open, onOpenChange }: PropertyEditorProps) {
  const { updateProperty, addOption } = schema;
  const isSelect = def.type === "select" || def.type === "multiSelect";
  const [newOption, setNewOption] = useState("");

  const patchOption = (id: string, changes: Partial<SelectOption>) =>
    updateProperty(def.id, {
      options: (def.options ?? []).map((o) => (o.id === id ? { ...o, ...changes } : o)),
    });
  const removeOption = (id: string) =>
    updateProperty(def.id, { options: (def.options ?? []).filter((o) => o.id !== id) });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="ft-prop-editor">
        <DialogHeader>
          <DialogTitle>Edit property</DialogTitle>
          <DialogDescription>{TYPE_LABELS[def.type]} property</DialogDescription>
        </DialogHeader>

        <label className="ft-field">
          <span className="ft-field-label">Name</span>
          <input
            className="ft-cell-input"
            defaultValue={def.name}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== def.name) updateProperty(def.id, { name: v });
            }}
          />
        </label>

        {isSelect && (
          <div className="ft-options">
            <span className="ft-field-label">Options</span>
            {(def.options ?? []).map((o) => (
              <div key={o.id} className="ft-option-row">
                <input
                  className="ft-option-name"
                  defaultValue={o.name}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== o.name) patchOption(o.id, { name: v });
                  }}
                />
                <div className="ft-swatches">
                  {TAG_PALETTE.map((c) => (
                    <button
                      key={c}
                      className={cn("ft-swatch", o.color === c && "active")}
                      style={{ backgroundColor: c, color: contrastText(c) }}
                      title="Set color"
                      onClick={() => patchOption(o.id, { color: c })}
                    />
                  ))}
                </div>
                <button className="ft-option-remove" title="Remove option" onClick={() => removeOption(o.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <form
              className="ft-option-add"
              onSubmit={(e) => {
                e.preventDefault();
                if (newOption.trim()) {
                  addOption(def.id, newOption.trim());
                  setNewOption("");
                }
              }}
            >
              <input
                className="ft-option-name"
                placeholder="New option…"
                value={newOption}
                onChange={(e) => setNewOption(e.target.value)}
              />
              <button type="submit" className="ft-option-add-btn" disabled={!newOption.trim()}>
                <Plus size={13} /> Add
              </button>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
