/**
 * Replaces BlockNote's built-in file-download toolbar button, which opens a
 * resolved attachment URL via `window.open`. That works for a normal http(s)
 * URL, but our `resolveFileUrl` returns a webview-internal `asset://` URL for
 * local attachments — the OS (or an external browser) has no handler for
 * that scheme, so `window.open` silently does nothing. Opening the real
 * filesystem path through Tauri's opener plugin is what actually works.
 */
import { useCallback } from "react";
import { ExternalLink } from "lucide-react";
import { blockHasType, type BlockSchema, type InlineContentSchema, type StyleSchema } from "@blocknote/core";
import { useBlockNoteEditor, useComponentsContext, useEditorState } from "@blocknote/react";
import { attachments } from "@/services";

export function FileOpenButton({ vaultPath, onError }: { vaultPath: string; onError: (message: string) => void }) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>();

  const block = useEditorState({
    editor,
    selector: ({ editor }) => {
      const selectedBlocks = editor.getSelection()?.blocks || [editor.getTextCursorPosition().block];
      if (selectedBlocks.length !== 1) return undefined;
      const block = selectedBlocks[0];
      if (!blockHasType(block, editor, block.type, { url: "string" })) return undefined;
      return block;
    },
  });

  const onClick = useCallback(() => {
    if (block !== undefined && block.props.url) {
      editor.focus();
      attachments.openFile(vaultPath, block.props.url as string).catch((e) => onError(String(e)));
    }
  }, [block, editor, vaultPath, onError]);

  if (block === undefined) return null;

  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      label="Open file"
      mainTooltip="Open file"
      icon={<ExternalLink size={16} />}
      onClick={onClick}
    />
  );
}
