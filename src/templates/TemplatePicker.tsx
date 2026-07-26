/**
 * Picker for choosing a template to insert into the current note (opened from the
 * editor's "Use template" button or the `template.use` shortcut, default Alt+T).
 * Mirrors the note-link picker's cmdk pattern; all data flows through `services`.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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
      title={t("templates.useTemplate")}
      description={t("templates.chooseToInsert")}
    >
      <Command>
        <CommandInput placeholder={t("templates.searchPlaceholder")} />
        <CommandList>
          <CommandEmpty>{t("templates.emptyPicker")}</CommandEmpty>
          {list.length > 0 && (
            <CommandGroup heading={t("templates.title")}>
              {list.map((tpl) => (
                <CommandItem
                  key={tpl.id}
                  value={`${tpl.title} ${tpl.id}`}
                  onSelect={() => {
                    onPick(tpl);
                    onOpenChange(false);
                  }}
                >
                  {tpl.title || t("templates.untitled")}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
