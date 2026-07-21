import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** What the user asked to delete — drives both the confirm copy and the action
 *  taken on confirm (see {@link useDeletion}). */
export type PendingDelete =
  | { kind: "note"; id: string; title: string }
  | { kind: "folder"; path: string; name: string; hasChildren: boolean }
  | { kind: "template"; id: string; title: string }
  | { kind: "group"; id: string; name: string };

interface DeleteConfirmDialogProps {
  pendingDelete: PendingDelete | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** In-app delete confirmation (not `window.confirm`) shared by every deletable
 *  kind — note, folder, template, and folder group — with kind-specific copy. */
export function DeleteConfirmDialog({ pendingDelete, onCancel, onConfirm }: DeleteConfirmDialogProps) {
  return (
    <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pendingDelete?.kind === "folder" || pendingDelete?.kind === "group"
              ? `Delete "${pendingDelete.name}"?`
              : `Delete "${pendingDelete?.title || (pendingDelete?.kind === "template" ? "Untitled template" : "Untitled")}"?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pendingDelete?.kind === "note"
              ? "This note will be permanently deleted."
              : pendingDelete?.kind === "template"
                ? "This template will be permanently deleted. Notes created from it are not affected."
                : pendingDelete?.kind === "group"
                  ? "This group will be removed. The folders inside it are not deleted — they'll just no longer be grouped."
                  : pendingDelete?.hasChildren
                    ? "This folder and everything inside it — all notes and subfolders — will be permanently deleted."
                    : "This empty folder will be permanently deleted."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
