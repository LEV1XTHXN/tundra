import { useState } from "react";
import { CalendarDays, Hash, List, ListChecks, Plus, Type } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { sameColumnKey, type BuiltinColumn, type PropertyType } from "@/store/folderViews";
import type { useFolderSchema } from "./useFolderSchema";

type Schema = ReturnType<typeof useFolderSchema>;

const BUILTINS: { key: BuiltinColumn; labelKey: string }[] = [
  { key: "modified", labelKey: "folderView.columnModified" },
  { key: "created", labelKey: "folderView.columnCreated" },
  { key: "size", labelKey: "folderView.columnSize" },
];

const TYPES: { type: PropertyType; labelKey: string; icon: React.ReactNode }[] = [
  { type: "text", labelKey: "folderView.typeText", icon: <Type size={14} /> },
  { type: "number", labelKey: "folderView.typeNumber", icon: <Hash size={14} /> },
  { type: "select", labelKey: "folderView.typeSelect", icon: <List size={14} /> },
  { type: "multiSelect", labelKey: "folderView.typeMultiSelect", icon: <ListChecks size={14} /> },
  { type: "date", labelKey: "folderView.typeDate", icon: <CalendarDays size={14} /> },
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
  const { t } = useTranslation();
  const { columns, addBuiltinColumn, createProperty } = schema;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("text");

  const availableBuiltins = BUILTINS.filter((b) => !columns.some((c) => sameColumnKey(c, b.key)));

  function create() {
    createProperty(name.trim() || t("folderView.columnProperty"), type);
    setName("");
    setType("text");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="ft-add-column" title={t("folderView.addColumn")}>
          <Plus size={15} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="ft-add-popover" align="end">
        <div className="ft-add-section">
          <div className="ft-add-heading">{t("folderView.newProperty")}</div>
          <input
            className="ft-cell-input"
            placeholder={t("folderView.propertyNamePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <div className="ft-type-grid">
            {TYPES.map((opt) => (
              <button
                key={opt.type}
                className={`ft-type-option${type === opt.type ? " active" : ""}`}
                onClick={() => setType(opt.type)}
              >
                {opt.icon}
                <span>{t(opt.labelKey)}</span>
              </button>
            ))}
          </div>
          <button className="ft-add-create" onClick={create}>
            {t("folderView.createProperty")}
          </button>
        </div>

        {availableBuiltins.length > 0 && (
          <div className="ft-add-section">
            <div className="ft-add-heading">{t("folderView.addMetadataColumn")}</div>
            {availableBuiltins.map((b) => (
              <button
                key={b.key}
                className="ft-menu-item"
                onClick={() => { addBuiltinColumn(b.key); setOpen(false); }}
              >
                {t(b.labelKey)}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
