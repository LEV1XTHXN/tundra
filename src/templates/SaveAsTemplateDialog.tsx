/**
 * Prompt for a name when saving the current note as a reusable template. The
 * actual create+save happens in the caller (the editor, which has the live
 * blocks + icon); this is just the name-entry dialog, mirroring App's "new
 * folder" dialog.
 */
import { useEffect, useState } from "react";

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
  const [name, setName] = useState(defaultName);

  // Re-seed the field each time the dialog opens with the current note's title.
  useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save as template</DialogTitle>
          <DialogDescription>
            Creates a reusable template from this note's current content. It won't appear in your
            notes tree, search, or graph.
          </DialogDescription>
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
            placeholder="Template name"
          />
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Save template
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
