/**
 * The custom BlockNote inline content node for a note-to-note link (Phase 2
 * step 3). It stores the target note's UUID plus a fallback label (the title at
 * insertion time). Identity is the id, so links survive rename/move with no
 * repair. The `type` MUST equal the Rust core's `LINK_INLINE_TYPE` ("noteLink")
 * and the id MUST live at `props.noteId` — that's the contract the `links`
 * module parses (see crates/tundra-core/src/links.rs).
 */
import { createReactInlineContentSpec } from "@blocknote/react";

import { useViewState } from "@/store/viewState";
import { useNoteTitle } from "@/store/linkTitles";

/** Keep in sync with `tundra_core::LINK_INLINE_TYPE`. */
export const NOTE_LINK_TYPE = "noteLink";

/** Renders a link. Priority for the shown text:
 *   1. `display` — a custom word/alias (e.g. linking the word "orchid" to a note
 *      titled "Orchidea nautilica"); fixed, never overridden by the title.
 *   2. the target's LIVE current title (so a rename updates the label).
 *   3. the stored `label` fallback if the target was deleted (styled as broken).
 * Clicking opens the target. */
function NoteLinkView({ noteId, label, display }: { noteId: string; label: string; display: string }) {
  const currentTitle = useNoteTitle(noteId);
  const exists = currentTitle !== undefined;
  const text = display || (exists ? currentTitle : label) || "Untitled";

  return (
    <span
      className={exists ? "note-link" : "note-link note-link-broken"}
      contentEditable={false}
      title={exists ? undefined : "This note no longer exists"}
      onClick={() => {
        if (exists) useViewState.getState().setOpenNoteId(noteId);
      }}
    >
      {text}
    </span>
  );
}

export const noteLinkSpec = createReactInlineContentSpec(
  {
    type: NOTE_LINK_TYPE,
    propSchema: {
      noteId: { default: "" },
      label: { default: "" },
      // Optional custom display word (alias). Empty → render the live title.
      display: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => (
      <NoteLinkView
        noteId={props.inlineContent.props.noteId}
        label={props.inlineContent.props.label}
        display={props.inlineContent.props.display}
      />
    ),
    // Export serialization: `[[text]]` (custom word if set, else the stored
    // label — per the locked links design) so Markdown/HTML export stays readable.
    toExternalHTML: (props) => (
      <span>{`[[${props.inlineContent.props.display || props.inlineContent.props.label}]]`}</span>
    ),
  },
);
