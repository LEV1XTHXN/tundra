import { useEffect, useRef, useState } from "react";

import { spellcheck } from "@/services";
import { attachSpellcheckPlugin, type SpellContext, type SpellcheckController } from "./spellcheckPlugin";
import type { NoteBlockEditor } from "./useNoteBlockEditor";

interface Params {
  editor: NoteBlockEditor;
  editorPaneRef: React.RefObject<HTMLDivElement | null>;
  onError: (message: string) => void;
}

export interface EditorContextMenus {
  /** Right-clicked-misspelling menu (suggestions + add-to-dictionary), or null. */
  spellMenu: SpellContext | null;
  setSpellMenu: (ctx: SpellContext | null) => void;
  replaceMisspelling: (ctx: SpellContext, replacement: string) => void;
  addToDictionary: (ctx: SpellContext) => void;
  /** The app's in-app format/block menu position (right-click), or null. */
  formatMenu: { x: number; y: number } | null;
  setFormatMenu: (pos: { x: number; y: number } | null) => void;
}

/**
 * The editor's two right-click menus (Phase 3 step 5). Spellcheck squiggles come
 * from the ProseMirror decoration plugin attached to BlockNote's live view; a
 * right-clicked misspelling opens the React suggestion menu. Right-clicking
 * anywhere else in the body opens the format/block menu at the click point. The
 * spellcheck plugin's `contextmenu` handler runs first (nearer ancestor) and can
 * `preventDefault`, so its menu takes priority over the format one.
 */
export function useEditorContextMenus({ editor, editorPaneRef, onError }: Params): EditorContextMenus {
  const [spellMenu, setSpellMenu] = useState<SpellContext | null>(null);
  const [formatMenu, setFormatMenu] = useState<{ x: number; y: number } | null>(null);
  const spellCtl = useRef<SpellcheckController | null>(null);

  // Attach the ProseMirror decoration plugin to BlockNote's live view once it
  // exists. Squiggles come from the Rust service (inert until a dictionary is
  // bundled). The context menu is React, opened from the plugin with the
  // misspelling + screen coords.
  useEffect(() => {
    const view = editor.prosemirrorView;
    if (!view) return;
    // Wrap onContext so a right-clicked misspelling's menu takes priority over
    // the block/formatting context menu below (which checks defaultPrevented).
    const ctl = attachSpellcheckPlugin(view, (text) => spellcheck.check(text), setSpellMenu);
    spellCtl.current = ctl;
    return () => {
      ctl.detach();
      spellCtl.current = null;
    };
  }, [editor]);

  // App-specific in-app context menu, replacing the system one: right-clicking
  // anywhere in the note body opens the formatting/block menu (the same one
  // BlockNote used to auto-pop on text selection — that auto-popup is now off,
  // see `formattingToolbar={false}` in NoteEditor) at the click point instead.
  // Scoped to `.bn-editor` so right-clicking the title input or other chrome
  // keeps its normal native menu. Registered on the BUBBLE phase on an ANCESTOR
  // of ProseMirror's view.dom, so it always runs after spellcheckPlugin's own
  // `handleDOMEvents.contextmenu` (attached directly to view.dom, a nearer
  // ancestor of the click target) — checking `defaultPrevented` lets a
  // right-clicked misspelling's suggestion menu take priority over this one.
  useEffect(() => {
    const container = editorPaneRef.current;
    if (!container) return;
    function onContextMenu(event: MouseEvent) {
      if (event.defaultPrevented) return;
      if (!(event.target as HTMLElement).closest(".bn-editor")) return;
      event.preventDefault();
      setFormatMenu({ x: event.clientX, y: event.clientY });
    }
    container.addEventListener("contextmenu", onContextMenu);
    return () => container.removeEventListener("contextmenu", onContextMenu);
  }, []);

  // --- spellcheck context-menu actions -----------------------------------
  function replaceMisspelling(ctx: SpellContext, replacement: string) {
    const view = editor.prosemirrorView;
    if (view) view.dispatch(view.state.tr.insertText(replacement, ctx.from, ctx.to));
    setSpellMenu(null);
    spellCtl.current?.recheckAll();
  }
  function addToDictionary(ctx: SpellContext) {
    setSpellMenu(null);
    spellcheck
      .addWord(ctx.word)
      .then(() => spellCtl.current?.recheckAll())
      .catch((e) => onError(String(e)));
  }

  return { spellMenu, setSpellMenu, replaceMisspelling, addToDictionary, formatMenu, setFormatMenu };
}
