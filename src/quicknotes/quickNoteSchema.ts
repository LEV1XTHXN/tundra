/**
 * Trimmed BlockNote schema for the quick-note scratchpad (Phase 2 step 5). Quick
 * capture is basic text + lists + attachments only: NO note links (the custom
 * `noteLink` inline content is deliberately absent, so `[[` does nothing here),
 * and no heavy structural blocks (headings, tables). Content jotted here gets
 * reorganized into real notes later, where the full editor + links live.
 */
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";

export const quickNoteSchema = BlockNoteSchema.create({
  // Explicit allow-list (basic text, every list kind, attachments). Omitting
  // `heading` and `table` keeps the slash menu lean for fast capture. Default
  // inline content (plain text + web links) is kept; `noteLink` is NOT added.
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    quote: defaultBlockSpecs.quote,
    divider: defaultBlockSpecs.divider,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    toggleListItem: defaultBlockSpecs.toggleListItem,
    codeBlock: defaultBlockSpecs.codeBlock,
    image: defaultBlockSpecs.image,
    video: defaultBlockSpecs.video,
    audio: defaultBlockSpecs.audio,
    file: defaultBlockSpecs.file,
  },
});
