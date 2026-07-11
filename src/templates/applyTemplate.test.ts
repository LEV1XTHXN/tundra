import { describe, expect, it } from "vitest";
import { isEmptyDocument, stripBlockIds, type RawBlock } from "./applyTemplate";

/** A text node inline-content array, matching BlockNote's shape. */
function text(t: string): RawBlock["content"] {
  return [{ type: "text", text: t, styles: {} }];
}

describe("isEmptyDocument", () => {
  it("treats a fresh single empty paragraph as blank", () => {
    expect(isEmptyDocument([{ id: "a", type: "paragraph" }])).toBe(true);
  });

  it("treats whitespace-only and multiple blank text blocks as blank", () => {
    expect(
      isEmptyDocument([
        { id: "a", type: "paragraph" },
        { id: "b", type: "heading", content: text("   \n\t ") },
      ]),
    ).toBe(true);
  });

  it("is not blank when any text block has real text", () => {
    expect(isEmptyDocument([{ id: "a", type: "paragraph", content: text("hello") }])).toBe(false);
  });

  it("is not blank when a non-text block is present, even without text", () => {
    expect(
      isEmptyDocument([{ id: "img", type: "image", props: { url: "x.png" } }]),
    ).toBe(false);
  });

  it("is not blank when text is nested in a child", () => {
    expect(
      isEmptyDocument([
        { id: "p", type: "paragraph", children: [{ id: "c", type: "paragraph", content: text("deep") }] },
      ]),
    ).toBe(false);
  });

  it("treats a note-link inline as content", () => {
    expect(
      isEmptyDocument([
        { id: "a", type: "paragraph", content: [{ type: "noteLink", props: { noteId: "x" } }] },
      ]),
    ).toBe(false);
  });
});

describe("stripBlockIds", () => {
  it("removes ids recursively so BlockNote reassigns them", () => {
    const out = stripBlockIds([
      { id: "1", type: "paragraph", content: text("a"), children: [{ id: "2", type: "paragraph", content: text("b") }] },
    ]);
    expect(out).toEqual([
      { type: "paragraph", content: text("a"), children: [{ type: "paragraph", content: text("b") }] },
    ]);
    expect(JSON.stringify(out)).not.toContain('"id"');
  });

  it("drops null props/content and empty children (valid PartialBlock)", () => {
    const out = stripBlockIds([{ id: "1", type: "paragraph", props: null, content: null, children: [] }]);
    expect(out).toEqual([{ type: "paragraph" }]);
  });

  it("keeps non-null props", () => {
    const out = stripBlockIds([{ id: "1", type: "image", props: { url: "x.png" } }]);
    expect(out).toEqual([{ type: "image", props: { url: "x.png" } }]);
  });
});
