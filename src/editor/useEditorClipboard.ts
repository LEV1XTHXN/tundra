import { useEffect } from "react";

import { attachments } from "@/services";
import { attachmentKindFromMime } from "./attachmentKind";
import type { NoteBlockEditor } from "./useNoteBlockEditor";

interface Params {
  editor: NoteBlockEditor;
  editorPaneRef: React.RefObject<HTMLDivElement | null>;
  vaultPath: string;
  onError: (message: string) => void;
}

/**
 * Attachment interactions on the live editor DOM: intercept pasted files, and
 * open a clicked file block. Both attach to the editor pane element; effects only.
 */
export function useEditorClipboard({ editor, editorPaneRef, vaultPath, onError }: Params): void {
  // Windows Explorer's "copy" on a file puts BOTH a file entry and a
  // text/plain path onto the clipboard. BlockNote's own paste handler picks
  // among clipboard types by a fixed priority list that ranks text/plain
  // ahead of "Files" (see @blocknote/core's fromClipboard), so it silently
  // pastes the path as text instead of the actual image. Intercept in the
  // capture phase — which runs before ProseMirror's own paste listener,
  // bound directly to the editor's DOM node — and prefer the real file
  // whenever the clipboard actually carries one.
  useEffect(() => {
    const container = editorPaneRef.current;
    if (!container) return;
    function onPasteCapture(event: ClipboardEvent) {
      const files = event.clipboardData?.files;
      if (!files || files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      void (async () => {
        let ref = editor.getTextCursorPosition().block;
        for (const file of Array.from(files)) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const url = await attachments.import(attachmentKindFromMime(file.type), file.name, bytes);
          // BlockNote's own upload flow (drag-and-drop) sets props.name from the
          // File object up front; this paste path bypasses that flow entirely; so
          // without this, pasted files show a blank name next to the icon.
          const [inserted] = editor.insertBlocks(
            [{ type: attachmentKindFromMime(file.type), props: { url, name: "_" } } as never],
            ref,
            "after",
          );
          ref = inserted;
        }
      })();
    }
    container.addEventListener("paste", onPasteCapture, true);
    return () => container.removeEventListener("paste", onPasteCapture, true);
  }, [editor]);

  // Clicking a "file" block opens it directly (image/video blocks already
  // render inline, so an unexpected external-open on click there would be
  // surprising — this is scoped to plain file attachments only, which
  // otherwise show just an icon + name with no built-in interaction).
  useEffect(() => {
    const container = editorPaneRef.current;
    if (!container) return;
    function onClick(event: MouseEvent) {
      const target = event.target as HTMLElement;
      const wrapper = target.closest(".bn-file-block-content-wrapper");
      if (!wrapper) return;
      const blockEl = wrapper.closest("[data-id]");
      const blockId = blockEl?.getAttribute("data-id");
      if (!blockId) return;
      const block = editor.getBlock(blockId);
      if (block?.type !== "file" || !block.props.url) return;
      attachments.openFile(vaultPath, block.props.url as string).catch((e) => onError(String(e)));
    }
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, [editor, vaultPath, onError]);
}
