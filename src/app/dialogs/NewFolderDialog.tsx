import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { CreationDialog } from "../hooks/useCreationDialogs";

/** Name-entry dialog for creating a folder (at the vault root). Bound entirely
 *  by the {@link CreationDialog} bundle from `useCreationDialogs`. */
export function NewFolderDialog({ open, onOpenChange, name, onNameChange, onCreate }: CreationDialog) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onCreate();
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Folder name"
          />
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
