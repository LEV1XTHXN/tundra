import { useCreateBlockNote } from "@blocknote/react";

import { attachments } from "@/services";
import type { Note } from "@/services";
import { editorSchema } from "./schema";
import { toInitialContent } from "./blockContent";
import { attachmentKindFromMime } from "./attachmentKind";

/**
 * The BlockNote editor instance created for a note (shared schema with the custom
 * `noteLink` inline node). Exported so the editor's behavior hooks can accept the
 * editor without re-deriving BlockNote's generics from the custom schema.
 */
export type NoteBlockEditor = ReturnType<typeof useNoteBlockEditor>;

interface Params {
  note: Note;
  vaultPath: string;
}

/**
 * Build the note's BlockNote editor. Its document JSON is loaded verbatim (no
 * transformation) — the core treats blocks as opaque, validated-but-unmodeled
 * JSON (Phase 1 preamble), so this is the one place the shape actually matters.
 * The parent remounts this (keyed by `note.id`), so the editor is always created
 * fresh with the right `initialContent`, never reused/rehydrated across notes.
 */
export function useNoteBlockEditor({ note, vaultPath }: Params) {
  return useCreateBlockNote({
    schema: editorSchema,
    // Opaque block JSON from the core; the editor's exact PartialBlock type for
    // the custom schema isn't worth reconstructing here (blocks are validated
    // but unmodeled by the core — Phase 1 preamble).
    initialContent: toInitialContent(note.blocks) as never,
    // Attachments (Phase 2 step 1): BlockNote's built-in image/video/file blocks
    // upload through here. We route the bytes through Rust's content-addressed
    // store and store the returned vault-RELATIVE path in the block (portable —
    // survives moving/syncing the vault). No attachment bytes are written from
    // the frontend; the core owns all FS work.
    uploadFile: async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return attachments.import(attachmentKindFromMime(file.type), file.name, bytes);
    },
    // Turn the stored vault-relative path into a displayable asset URL at render
    // time (like note icons). Anything else (e.g. a pasted external URL) is left
    // untouched.
    resolveFileUrl: async (url: string) =>
      url.startsWith("attachments/") ? attachments.resolveUrl(vaultPath, url) : url,
    // Web links: use BlockNote's built-in behaviour — select text and paste a
    // URL over it (or Ctrl+K) to create a link. BlockNote's default paste
    // already parses Markdown, so no custom pasteHandler is needed. (We tried a
    // `[text](url)` typing input rule, but it didn't fire reliably in the
    // WebKitGTK webview, so we dropped it in favour of the built-in path.)
  });
}
