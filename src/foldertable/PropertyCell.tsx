import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Check, Plus, X } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { PropertyValue } from "@/services";
import { tagChipStyle } from "@/store/tagColors";
import type { PropertyDef, SelectOption } from "@/store/folderViews";

interface PropertyCellProps {
  def: PropertyDef;
  value: PropertyValue | undefined;
  /** Set a new value, or clear it with `null`. */
  onChange: (value: PropertyValue | null) => void;
  /** Quick-add a new select option (returns it) — lets the user extend the
   *  choice set from the cell without opening the property editor. */
  onAddOption: (name: string) => SelectOption;
}

/** Look up an option definition by id. */
function optionById(def: PropertyDef, id: string): SelectOption | undefined {
  return def.options?.find((o) => o.id === id);
}

/** A colored option chip (shared visual with tags/Kanban). */
function OptionChip({ option, onRemove }: { option: SelectOption; onRemove?: () => void }) {
  return (
    <span className="ft-chip" style={tagChipStyle(option.color)}>
      {option.name}
      {onRemove && (
        <button
          className="ft-chip-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
}

export function PropertyCell({ def, value, onChange, onAddOption }: PropertyCellProps) {
  switch (def.type) {
    case "text":
      return <TextCell value={value?.type === "text" ? value.value : ""} onChange={(v) => onChange(v ? { type: "text", value: v } : null)} />;
    case "number":
      return (
        <NumberCell
          value={value?.type === "number" ? value.value : null}
          onChange={(v) => onChange(v === null ? null : { type: "number", value: v })}
        />
      );
    case "date":
      return (
        <DateCell
          value={value?.type === "date" ? value.value : null}
          onChange={(v) => onChange(v ? { type: "date", value: v } : null)}
        />
      );
    case "select":
      return (
        <SelectCell
          def={def}
          selected={value?.type === "select" ? value.value : null}
          onChange={(id) => onChange(id ? { type: "select", value: id } : null)}
          onAddOption={onAddOption}
        />
      );
    case "multiSelect":
      return (
        <MultiSelectCell
          def={def}
          selected={value?.type === "multiSelect" ? value.value : []}
          onChange={(ids) => onChange(ids.length ? { type: "multiSelect", value: ids } : null)}
          onAddOption={onAddOption}
        />
      );
  }
}

function TextCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (editing) {
    return (
      <input
        autoFocus
        className="ft-cell-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== value) onChange(draft.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <button className="ft-cell-button" onClick={() => { setDraft(value); setEditing(true); }}>
      {value || <span className="ft-cell-empty">Empty</span>}
    </button>
  );
}

function NumberCell({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        className="ft-cell-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const trimmed = draft.trim();
          if (trimmed === "") onChange(null);
          else {
            const n = Number(trimmed);
            if (!Number.isNaN(n)) onChange(n);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }
  return (
    <button className="ft-cell-button" onClick={() => { setDraft(value === null ? "" : String(value)); setEditing(true); }}>
      {value === null ? <span className="ft-cell-empty">Empty</span> : value}
    </button>
  );
}

function DateCell({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseISO(value) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="ft-cell-button">
          {selected ? format(selected, "MMMM d, yyyy") : <span className="ft-cell-empty">Empty</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="ft-date-popover" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => {
            onChange(d ? format(d, "yyyy-MM-dd") : null);
            setOpen(false);
          }}
        />
        {value && (
          <button className="ft-popover-clear" onClick={() => { onChange(null); setOpen(false); }}>
            <X size={12} /> Clear
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function SelectCell({
  def,
  selected,
  onChange,
  onAddOption,
}: {
  def: PropertyDef;
  selected: string | null;
  onChange: (id: string | null) => void;
  onAddOption: (name: string) => SelectOption;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = selected ? optionById(def, selected) : undefined;
  const options = def.options ?? [];
  const matches = options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()));
  const canCreate = query.trim() !== "" && !options.some((o) => o.name.toLowerCase() === query.trim().toLowerCase());

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <PopoverTrigger asChild>
        <button className="ft-cell-button">
          {current ? <OptionChip option={current} /> : <span className="ft-cell-empty">Empty</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="ft-select-popover" align="start">
        <input
          autoFocus
          className="ft-select-search"
          placeholder="Search or create…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="ft-select-list">
          {matches.map((o) => (
            <button
              key={o.id}
              className="ft-select-option"
              onClick={() => { onChange(o.id); setOpen(false); setQuery(""); }}
            >
              <OptionChip option={o} />
              {selected === o.id && <Check size={13} className="ft-select-check" />}
            </button>
          ))}
          {canCreate && (
            <button
              className="ft-select-option ft-select-create"
              onClick={() => {
                const created = onAddOption(query.trim());
                onChange(created.id);
                setOpen(false);
                setQuery("");
              }}
            >
              <Plus size={12} /> Create “{query.trim()}”
            </button>
          )}
        </div>
        {selected && (
          <button className="ft-popover-clear" onClick={() => { onChange(null); setOpen(false); }}>
            <X size={12} /> Clear
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function MultiSelectCell({
  def,
  selected,
  onChange,
  onAddOption,
}: {
  def: PropertyDef;
  selected: string[];
  onChange: (ids: string[]) => void;
  onAddOption: (name: string) => SelectOption;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const options = def.options ?? [];
  const chosen = selected.map((id) => optionById(def, id)).filter((o): o is SelectOption => !!o);
  const matches = options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()));
  const canCreate = query.trim() !== "" && !options.some((o) => o.name.toLowerCase() === query.trim().toLowerCase());

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <PopoverTrigger asChild>
        <button className="ft-cell-button ft-cell-chips">
          {chosen.length ? (
            chosen.map((o) => <OptionChip key={o.id} option={o} onRemove={() => toggle(o.id)} />)
          ) : (
            <span className="ft-cell-empty">Empty</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="ft-select-popover" align="start">
        <input
          autoFocus
          className="ft-select-search"
          placeholder="Search or create…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="ft-select-list">
          {matches.map((o) => (
            <button key={o.id} className="ft-select-option" onClick={() => toggle(o.id)}>
              <OptionChip option={o} />
              {selected.includes(o.id) && <Check size={13} className="ft-select-check" />}
            </button>
          ))}
          {canCreate && (
            <button
              className="ft-select-option ft-select-create"
              onClick={() => {
                const created = onAddOption(query.trim());
                onChange([...selected, created.id]);
                setQuery("");
              }}
            >
              <Plus size={12} /> Create “{query.trim()}”
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
