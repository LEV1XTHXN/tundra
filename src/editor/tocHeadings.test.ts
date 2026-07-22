import { describe, expect, it } from "vitest";

import { extractHeadings } from "./tocHeadings";
import { NOTE_LINK_TYPE } from "./NoteLink";

const text = (t: string) => ({ type: "text", text: t, styles: {} });
const link = (label: string) => ({ type: NOTE_LINK_TYPE, props: { noteId: "x", label, display: "" } });
const heading = (id: string, level: number, content: unknown[]) => ({
  id,
  type: "heading",
  props: { level },
  content,
});

describe("extractHeadings", () => {
  it("returns headings in document order with their level and text", () => {
    const blocks = [
      heading("h1", 1, [text("World")]),
      { id: "p", type: "paragraph", content: [text("body")] },
      heading("h2", 2, [text("География")]),
    ];
    expect(extractHeadings(blocks)).toEqual([
      { id: "h1", level: 1, text: "World" },
      { id: "h2", level: 2, text: "География" },
    ]);
  });

  it("uses a note link's label as part of the heading text", () => {
    const blocks = [heading("h1", 1, [text("See "), link("Photosynthesis")])];
    expect(extractHeadings(blocks)).toEqual([{ id: "h1", level: 1, text: "See Photosynthesis" }]);
  });

  it("skips headings with no visible text", () => {
    const blocks = [heading("empty", 1, []), heading("blank", 2, [text("   ")]), heading("h", 1, [text("Kept")])];
    expect(extractHeadings(blocks)).toEqual([{ id: "h", level: 1, text: "Kept" }]);
  });

  it("finds headings nested inside other blocks (columns/toggles)", () => {
    const blocks = [
      {
        id: "col",
        type: "column",
        content: undefined,
        children: [heading("nested", 3, [text("Deep")])],
      },
    ];
    expect(extractHeadings(blocks)).toEqual([{ id: "nested", level: 3, text: "Deep" }]);
  });

  it("collapses whitespace and defaults a missing level to 1", () => {
    const blocks = [{ id: "h", type: "heading", props: {}, content: [text("  spaced   out  ")] }];
    expect(extractHeadings(blocks)).toEqual([{ id: "h", level: 1, text: "spaced out" }]);
  });

  it("returns an empty array for non-array or heading-less input", () => {
    expect(extractHeadings(null)).toEqual([]);
    expect(extractHeadings([{ id: "p", type: "paragraph", content: [text("hi")] }])).toEqual([]);
  });
});
