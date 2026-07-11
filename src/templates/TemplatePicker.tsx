/**
 * Picker for choosing a template to insert into the current note (opened from the
 * editor's "Use template" button or the `template.use` shortcut, default Alt+T).
 * Mirrors the note-link picker's cmdk pattern; all data flows through `services`.
 */
import { useEffect, useState } from "react";

import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { templates } from "@/services";
import type { TemplateSummary } from "@/services";

interface TemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (template: TemplateSummary) => void;
}

export function TemplatePicker({ open, onOpenChange, onPick }: TemplatePickerProps) {
  const [list, setList] = useState<TemplateSummary[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    templates
      .list()
      .then((l) => {
        if (!cancelled) setList(l);
      })
      .catch(() => {
        if (!cancelled) setList([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Use template"
      description="Choose a template to insert into this note"
    >
      <Command>
        <CommandInput placeholder="Search templates…" />
        <CommandList>
          <CommandEmpty>
            No templates. Create one with “Save as template” in a note’s header, or in
            Settings ▸ Templates.
          </CommandEmpty>
          {list.length > 0 && (
            <CommandGroup heading="Templates">
              {list.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`${t.title} ${t.id}`}
                  onSelect={() => {
                    onPick(t);
                    onOpenChange(false);
                  }}
                >
                  {t.title || "Untitled template"}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
