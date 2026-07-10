import { useState } from "react";
import { CalendarDays, Hash, List, ListChecks, Plus, Type } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { sameColumnKey, type BuiltinColumn, type PropertyType } from "@/store/folderViews";
import type { useFolderSchema } from "./useFolderSchema";

type Schema = ReturnType<typeof useFolderSchema>;

const BUILTINS: { key: BuiltinColumn; label: string }[] = [
  { key: "modified", label: "Last modified" },
  { key: "created", label: "Created" },
  { key: "size", label: "Size" },
];

const TYPES: { type: PropertyType; label: string; icon: React.ReactNode }[] = [
  { type: "text", label: "Text", icon: <Type size={14} /> },
  { type: "number", label: "Number", icon: <Hash size={14} /> },
  { type: "select", label: "Select", icon: <List size={14} /> },
  { type: "multiSelect", label: "Multi-select", icon: <ListChecks size={14} /> },
  { type: "date", label: "Date", icon: <CalendarDays size={14} /> },
];

interface AddColumnPopoverProps {
  schema: Schema;
}

/**
 * The "+" header control: add a built-in metadata column (if not already shown)
 * or create a new custom property of one of the five primitive types. Naming the
 * property + defining options happens inline for text/number/date; for
 * select/multi-select the user adds options from the cell (quick-add) or the
 * property editor.
 */
export function AddColumnPopover({ schema }: AddColumnPopoverProps) {
  const { columns, addBuiltinColumn, createProperty } = schema;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("text");

  const availableBuiltins = BUILTINS.filter((b) => !columns.some((c) => sameColumnKey(c, b.key)));

  function create() {
    createProperty(name.trim() || "Property", type);
    setName("");
    setType("text");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="ft-add-column" title="Add column">
          <Plus size={15} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="ft-add-popover" align="end">
        <div className="ft-add-section">
          <div className="ft-add-heading">New property</div>
          <input
            className="ft-cell-input"
            placeholder="Property name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <div className="ft-type-grid">
            {TYPES.map((t) => (
              <button
                key={t.type}
                className={`ft-type-option${type === t.type ? " active" : ""}`}
                onClick={() => setType(t.type)}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          <button className="ft-add-create" onClick={create}>
            Create property
          </button>
        </div>

        {availableBuiltins.length > 0 && (
          <div className="ft-add-section">
            <div className="ft-add-heading">Add metadata column</div>
            {availableBuiltins.map((b) => (
              <button
                key={b.key}
                className="ft-menu-item"
                onClick={() => { addBuiltinColumn(b.key); setOpen(false); }}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
