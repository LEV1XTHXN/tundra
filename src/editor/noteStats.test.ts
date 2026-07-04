import { describe, expect, it } from "vitest";

import { noteStats } from "./noteStats";
import { NOTE_LINK_TYPE } from "./NoteLink";

const text = (t: string) => ({ type: "text", text: t, styles: {} });
const link = (label: string) => ({ type: NOTE_LINK_TYPE, props: { noteId: "x", label, display: "" } });

describe("noteStats", () => {
  it("counts words and characters across paragraphs", () => {
    const blocks = [
      { id: "1", type: "paragraph", content: [text("hello world")] },
      { id: "2", type: "paragraph", content: [text("three more words")] },
    ];
    // "hello world" + block break + "three more words" → 28 visible chars.
    expect(noteStats(blocks)).toEqual({ words: 5, characters: 28, linksOut: 0 });
  });

  it("counts outgoing note links and includes their label text", () => {
    const blocks = [
      { id: "1", type: "paragraph", content: [text("see "), link("Photosynthesis")] },
    ];
    const s = noteStats(blocks);
    expect(s.linksOut).toBe(1);
    expect(s.words).toBe(2); // "see" + "Photosynthesis"
  });

  it("descends into nested children (e.g. list items)", () => {
    const blocks = [
      {
        id: "1",
        type: "bulletListItem",
        content: [text("top")],
        children: [{ id: "2", type: "bulletListItem", content: [text("nested item")] }],
      },
    ];
    expect(noteStats(blocks).words).toBe(3);
  });

  it("ignores formatting props/styles and collapses whitespace", () => {
    const blocks = [{ id: "1", type: "paragraph", content: [{ type: "text", text: "  a   b  ", styles: { bold: true } }] }];
    expect(noteStats(blocks)).toEqual({ words: 2, characters: 3, linksOut: 0 });
  });

  it("returns zeros for an empty note", () => {
    expect(noteStats([{ id: "1", type: "paragraph", content: [] }])).toEqual({
      words: 0,
      characters: 0,
      linksOut: 0,
    });
  });
});
