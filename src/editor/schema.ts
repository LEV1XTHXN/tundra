/**
 * The shared BlockNote schema (Phase 2 step 3): the default blocks/inline
 * content plus our custom `noteLink` inline node. The SAME schema must be used
 * everywhere an editor is created (the main note editor, and the trimmed
 * quick-note editor in step 5) so link nodes render and serialize consistently.
 */
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";

import { noteLinkSpec, NOTE_LINK_TYPE } from "./NoteLink";
import { lazyMediaBlockSpecs } from "./mediaBlockSpecs";

export const editorSchema = BlockNoteSchema.create({
  // The default blocks, except `video`/`audio`, which are swapped for
  // click-to-play versions. Not cosmetic: a live media element crashes the
  // whole WebKitGTK web process when GStreamer has no audio sink — see
  // `mediaBlockSpecs.tsx` for the full story.
  blockSpecs: {
    ...defaultBlockSpecs,
    ...lazyMediaBlockSpecs,
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    [NOTE_LINK_TYPE]: noteLinkSpec,
  },
});
