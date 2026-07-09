import { describe, expect, it } from "vitest";
import { Schema } from "prosemirror-model";

import { changedRange, spellcheckRanges, unionRange, type SpellMisspelling } from "./spellcheckPlugin";

describe("spellcheckRanges", () => {
  it("maps a text node's UTF-16 offsets to document positions at basePos + offset", () => {
    const items: SpellMisspelling[] = [
      { offset: 6, length: 4, word: "wrld", suggestions: ["world"] },
      { offset: 0, length: 5, word: "helo", suggestions: ["hello", "help"] },
    ];
    // A text node starting at position 1 (just inside the first paragraph).
    const ranges = spellcheckRanges(1, items);
    expect(ranges[0]).toEqual({ from: 7, to: 11, word: "wrld", suggestions: ["world"] });
    expect(ranges[1]).toEqual({ from: 1, to: 6, word: "helo", suggestions: ["hello", "help"] });
  });

  it("returns nothing for a node with no misspellings", () => {
    expect(spellcheckRanges(42, [])).toEqual([]);
  });
});

describe("unionRange", () => {
  it("returns b when there is no accumulated range", () => {
    expect(unionRange(null, { from: 3, to: 8 })).toEqual({ from: 3, to: 8 });
  });

  it("expands to cover both ranges", () => {
    expect(unionRange({ from: 5, to: 10 }, { from: 2, to: 7 })).toEqual({ from: 2, to: 10 });
    expect(unionRange({ from: 5, to: 10 }, { from: 12, to: 20 })).toEqual({ from: 5, to: 20 });
  });
});

describe("changedRange", () => {
  const schema = new Schema({
    nodes: { doc: { content: "block+" }, paragraph: { group: "block", content: "text*" }, text: {} },
  });
  const docOf = (...paras: string[]) =>
    schema.node(
      "doc",
      null,
      paras.map((t) => schema.node("paragraph", null, t ? [schema.text(t)] : [])),
    );

  it("is null for identical documents (nothing to re-check)", () => {
    expect(changedRange(docOf("hello world"), docOf("hello world"))).toBeNull();
  });

  it("brackets the edited region, not the whole document", () => {
    // Only the second paragraph changed; the range must start after the first.
    const before = docOf("unchanged first line", "hello world");
    const after = docOf("unchanged first line", "hello wxrld");
    const r = changedRange(before, after)!;
    expect(r).not.toBeNull();
    // "unchanged first line" occupies positions 1..21 (+2 for the paragraph
    // boundaries), so the change must be well past the first paragraph.
    expect(r.from).toBeGreaterThan(20);
    expect(r.to).toBeGreaterThanOrEqual(r.from);
    expect(r.to).toBeLessThanOrEqual(after.content.size);
  });
});
