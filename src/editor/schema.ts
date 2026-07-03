/**
 * The shared BlockNote schema (Phase 2 step 3): the default blocks/inline
 * content plus our custom `noteLink` inline node. The SAME schema must be used
 * everywhere an editor is created (the main note editor, and the trimmed
 * quick-note editor in step 5) so link nodes render and serialize consistently.
 */
import { BlockNoteSchema, defaultInlineContentSpecs } from "@blocknote/core";

import { noteLinkSpec, NOTE_LINK_TYPE } from "./NoteLink";

export const editorSchema = BlockNoteSchema.create({
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    [NOTE_LINK_TYPE]: noteLinkSpec,
  },
});
