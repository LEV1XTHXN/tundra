import { useMemo, useRef, useState } from "react";

import type { Note, NoteSummary } from "@/services";
import { NOTE_LINK_TYPE } from "./NoteLink";
import { convertTypedLinks, type Inline, type LinkTarget } from "./typedLinks";
import type { NoteBlockEditor } from "./useNoteBlockEditor";

/**
 * The `[[`/Ctrl+Shift+K note picker state. `display` is the text the link renders
 * as (the selected word for the shortcut, "" for the `[[` trigger which shows the
 * target's live title); `trailingSpace` is set for the `[[` path so a space is
 * inserted after the atomic link node, giving the caret editable text to land in.
 */
export interface LinkPickerState {
  open: boolean;
  display: string;
  trailingSpace: boolean;
}

interface Params {
  editor: NoteBlockEditor;
  note: Note;
  noteSummaries: Map<string, NoteSummary>;
}

export interface TypedLinks {
  linkPicker: LinkPickerState;
  setLinkPicker: React.Dispatch<React.SetStateAction<LinkPickerState>>;
  /** Open the picker to link the current selection (Ctrl+Shift+K). */
  openFromSelection: () => void;
  /** Run on the editor's `onChange`: open the picker on a typed `[[`, then
   *  upgrade any just-completed `[[Title]]` into a link node. */
  onEditorChange: () => void;
}

/**
 * Word → note linking (Phase 2 step 3). Typing `[[` opens the keyboard-navigable
 * note picker (the same cmdk palette as Ctrl+Shift+K and global search) — it
 * replaces BlockNote's inline suggestion menu, whose two-character trigger and
 * keyboard handling are unreliable on WebKitGTK (see typedLinks.ts). Manually
 * typed/pasted `[[Title]]` is also upgraded to an id-backed link node.
 */
export function useTypedLinks({ editor, note, noteSummaries }: Params): TypedLinks {
  const [linkPicker, setLinkPicker] = useState<LinkPickerState>({
    open: false,
    display: "",
    trailingSpace: false,
  });

  // A title→target lookup over the current summaries (case-insensitive, self
  // excluded), so the converter captures the target's id + real title once,
  // exactly like the menu.
  const titleToTarget = useMemo(() => {
    const map = new Map<string, LinkTarget>();
    noteSummaries.forEach((s) => {
      if (s.id === note.id) return; // no self-links
      const key = s.title.trim().toLowerCase();
      if (key && !map.has(key)) map.set(key, { id: s.id, title: s.title });
    });
    return map;
  }, [noteSummaries, note.id]);

  // Guards against the re-entrant onChange that `updateBlock` itself fires while
  // we're mid-conversion (which would otherwise recurse before converging).
  const convertingRef = useRef(false);

  function maybeConvertTypedLinks() {
    if (convertingRef.current) return;
    const block = editor.getTextCursorPosition().block;
    const content = block.content;
    // Only inline-content blocks (paragraph/heading/list item…); table content
    // and the like isn't a flat inline array — skip it.
    if (!Array.isArray(content)) return;
    const { changed, content: next } = convertTypedLinks(
      content as unknown as Inline[],
      (t) => titleToTarget.get(t.toLowerCase()),
      NOTE_LINK_TYPE,
    );
    if (!changed) return;
    convertingRef.current = true;
    try {
      editor.updateBlock(block, { content: next as never });
      // Keep typing flowing after the atomic link (and its trailing space).
      editor.setTextCursorPosition(block, "end");
    } finally {
      convertingRef.current = false;
    }
  }

  // Typing `[[` opens the note picker: we spot the two brackets at a collapsed
  // cursor, delete them, and open the picker; on pick the link is inserted at
  // that spot (ProseMirror keeps the collapsed selection over the modal, exactly
  // like the Ctrl+Shift+K path).
  function maybeOpenLinkPicker() {
    if (linkPicker.open) return;
    const view = editor.prosemirrorView;
    if (!view) return;
    const { from, empty } = view.state.selection;
    if (!empty || from < 2) return;
    if (view.state.doc.textBetween(from - 2, from) !== "[[") return;
    view.dispatch(view.state.tr.delete(from - 2, from));
    setLinkPicker({ open: true, display: "", trailingSpace: true });
  }

  const openFromSelection = () =>
    setLinkPicker({ open: true, display: editor.getSelectedText(), trailingSpace: false });

  const onEditorChange = () => {
    // Checked first so the brackets are stripped before anything else looks at
    // the text; then upgrade any just-completed `[[Title]]` before the save so
    // the persisted block tree carries the id-backed node, not literal text.
    maybeOpenLinkPicker();
    maybeConvertTypedLinks();
  };

  return { linkPicker, setLinkPicker, openFromSelection, onEditorChange };
}
