import { useState } from "react";

import { templates } from "@/services";
import type { Icon, Note } from "@/services";
import { useTemplates } from "@/store/templates";
import { isEmptyDocument, stripBlockIds, type RawBlock } from "@/templates/applyTemplate";
import { mergeNote } from "./noteMerge";
import type { NoteBlockEditor } from "./useNoteBlockEditor";

interface Params {
  editor: NoteBlockEditor;
  /** The note's current icon, carried onto a saved-as template. */
  icon: Icon | null | undefined;
  /** Schedule a body save after a programmatic template insert. */
  scheduleSave: () => void;
  /** Reflect the save-as-template write in the save-state indicator. */
  markSaved: () => void;
  onError: (message: string) => void;
}

export interface EditorTemplates {
  templatePickerOpen: boolean;
  setTemplatePickerOpen: (open: boolean) => void;
  saveAsTemplateOpen: boolean;
  setSaveAsTemplateOpen: (open: boolean) => void;
  applyTemplate: (templateId: string) => Promise<void>;
  saveAsTemplate: (name: string) => Promise<void>;
}

/**
 * Note-mode template actions (Phase 3). Inserting a saved template uses smart
 * apply: a blank note has its body REPLACED; a note with content gets the
 * template's blocks inserted after the cursor, so existing writing is never lost.
 * Saving the current note as a template creates a blank template then persists it
 * with the note's live blocks + icon — reusing the create + validated save path
 * with no special-case command.
 */
export function useEditorTemplates({ editor, icon, scheduleSave, markSaved, onError }: Params): EditorTemplates {
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [saveAsTemplateOpen, setSaveAsTemplateOpen] = useState(false);

  // Block ids are stripped first so BlockNote assigns fresh, unique ones
  // (inserting the same template twice must not collide ids — `Note::validate`
  // would reject the save). BlockNote doesn't reliably fire onChange for these
  // programmatic edits, so we schedule the save ourselves.
  async function applyTemplate(templateId: string) {
    try {
      const tpl = await templates.read(templateId);
      const blocks = stripBlockIds(tpl.blocks as unknown as RawBlock[]);
      if (blocks.length === 0) return;
      if (isEmptyDocument(editor.document as unknown as RawBlock[])) {
        editor.replaceBlocks(editor.document, blocks as never);
      } else {
        const ref = editor.getTextCursorPosition().block;
        editor.insertBlocks(blocks as never, ref, "after");
      }
      scheduleSave();
    } catch (e) {
      onError(String(e));
    }
  }

  async function saveAsTemplate(name: string) {
    try {
      const created = await templates.create(name);
      await templates.save(
        mergeNote(created, { icon: icon ?? undefined, blocks: editor.document as unknown as Note["blocks"] }),
      );
      // Keep the sidebar Templates section + Settings manager in sync.
      await useTemplates.getState().refresh();
      markSaved();
    } catch (e) {
      onError(String(e));
    }
  }

  return {
    templatePickerOpen,
    setTemplatePickerOpen,
    saveAsTemplateOpen,
    setSaveAsTemplateOpen,
    applyTemplate,
    saveAsTemplate,
  };
}
