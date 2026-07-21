import type { AttachmentKind } from "@/services";

/**
 * Map a browser `File`'s MIME type onto one of the vault's attachment libraries
 * (CLAUDE.md §5.2: `attachments/images|videos|files`). Pure so it's unit-testable
 * and shared by the editor's `uploadFile` config and the clipboard-paste path.
 */
export function attachmentKindFromMime(mime: string): AttachmentKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "file";
}
