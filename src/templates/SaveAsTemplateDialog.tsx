/**
 * Prompt for a name when saving the current note as a reusable template. The
 * actual create+save happens in the caller (the editor, which has the live
 * blocks + icon); this is just the name-entry dialog, mirroring App's "new
 * folder" dialog.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface SaveAsTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Suggested name (the current note's title). */
  defaultName: string;
  onSave: (name: string) => void;
}

export function SaveAsTemplateDialog({ open, onOpenChange, defaultName, onSave }: SaveAsTemplateDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(defaultName);

  // Re-seed the field each time the dialog opens with the current note's title.
  useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("templates.saveAsTemplate")}</DialogTitle>
          <DialogDescription>{t("templates.saveDescription")}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            onSave(trimmed);
            onOpenChange(false);
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("templates.namePlaceholder")}
          />
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {t("templates.saveTemplate")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
