import { describe, expect, it } from "vitest";
import { emptyDocument, toInitialContent } from "./blockContent";

describe("toInitialContent", () => {
  it("passes a well-formed BlockNote document through verbatim — lossless round-trip, stable ids", () => {
    const original = [
      {
        id: "b1",
        type: "heading",
        props: { level: 1 },
        content: [{ type: "text", text: "Hello", styles: {} }],
        children: [],
      },
      {
        id: "b2",
        type: "paragraph",
        props: {},
        content: [{ type: "text", text: "World", styles: { bold: true } }],
        children: [
          { id: "b2-child", type: "paragraph", props: {}, content: [], children: [] },
        ],
      },
    ];

    // Simulate the JSON round-trip through the Rust core (serialize -> save -> reload).
    const roundTripped = JSON.parse(JSON.stringify(original));
    const result = toInitialContent(roundTripped);

    expect(result).toEqual(original);
    expect((result[0] as { id: string }).id).toBe("b1");
    expect((result[1] as { children: { id: string }[] }).children[0].id).toBe("b2-child");
  });

  it("falls back to an empty document for the Phase 0 skeleton shape (string content)", () => {
    const phase0Shape = [{ id: "b1", type: "paragraph", content: "plain text body", children: [] }];
    expect(toInitialContent(phase0Shape)).toEqual(emptyDocument());
  });

  it("falls back to an empty document for empty/missing blocks", () => {
    expect(toInitialContent([])).toEqual(emptyDocument());
    expect(toInitialContent(undefined)).toEqual(emptyDocument());
    expect(toInitialContent(null)).toEqual(emptyDocument());
  });

  it("falls back to an empty document when blocks are missing required fields", () => {
    expect(toInitialContent([{ type: "paragraph" }])).toEqual(emptyDocument()); // missing id
    expect(toInitialContent([{ id: "b1" }])).toEqual(emptyDocument()); // missing type
  });
});
