import { describe, expect, it } from "vitest";

import { convertTypedLinks, type Inline, type LinkTarget } from "./typedLinks";
import { NOTE_LINK_TYPE } from "./NoteLink";

/** A resolver over a fixed title→id table (case-insensitive, like the editor's). */
function resolver(table: Record<string, string>): (title: string) => LinkTarget | undefined {
  const byLower = new Map<string, LinkTarget>();
  for (const [title, id] of Object.entries(table)) {
    byLower.set(title.toLowerCase(), { id, title });
  }
  return (title) => byLower.get(title.toLowerCase());
}

function text(t: string): Inline {
  return { type: "text", text: t, styles: {} };
}

const resolve = resolver({ Test: "id-test", "Cell Biology": "id-cell" });

describe("convertTypedLinks", () => {
  it("converts a bare [[Title]] to an id-backed link node (+ trailing space)", () => {
    const { changed, content } = convertTypedLinks([text("[[Test]]")], resolve, NOTE_LINK_TYPE);
    expect(changed).toBe(true);
    expect(content).toEqual([
      { type: NOTE_LINK_TYPE, props: { noteId: "id-test", label: "Test", display: "" } },
      { type: "text", text: " ", styles: {} },
    ]);
  });

  it("resolves case-insensitively and keeps the note's real title as the label", () => {
    const { content } = convertTypedLinks([text("see [[test]] here")], resolve, NOTE_LINK_TYPE);
    expect(content).toEqual([
      { type: "text", text: "see ", styles: {} },
      { type: NOTE_LINK_TYPE, props: { noteId: "id-test", label: "Test", display: "" } },
      { type: "text", text: " here", styles: {} },
    ]);
  });

  it("handles multi-word titles and multiple links in one text run", () => {
    const { content } = convertTypedLinks([text("[[Test]] and [[Cell Biology]]")], resolve, NOTE_LINK_TYPE);
    expect(content).toEqual([
      { type: NOTE_LINK_TYPE, props: { noteId: "id-test", label: "Test", display: "" } },
      { type: "text", text: " and ", styles: {} },
      { type: NOTE_LINK_TYPE, props: { noteId: "id-cell", label: "Cell Biology", display: "" } },
      { type: "text", text: " ", styles: {} },
    ]);
  });

  it("leaves an unresolved [[Title]] as literal text", () => {
    const { changed, content } = convertTypedLinks([text("[[Nope]]")], resolve, NOTE_LINK_TYPE);
    expect(changed).toBe(false);
    expect(content).toEqual([text("[[Nope]]")]);
  });

  it("does not fire until the closing ]] is present", () => {
    const { changed } = convertTypedLinks([text("[[Test")], resolve, NOTE_LINK_TYPE);
    expect(changed).toBe(false);
  });

  it("preserves existing non-text nodes (e.g. already-inserted links)", () => {
    const existing: Inline = { type: NOTE_LINK_TYPE, props: { noteId: "id-cell", label: "Cell Biology", display: "" } };
    const { content } = convertTypedLinks([existing, text(" then [[Test]]")], resolve, NOTE_LINK_TYPE);
    expect(content[0]).toBe(existing);
    expect(content).toContainEqual({
      type: NOTE_LINK_TYPE,
      props: { noteId: "id-test", label: "Test", display: "" },
    });
  });

  it("preserves the text run's styles on the split pieces", () => {
    const styled: Inline = { type: "text", text: "a [[Test]] b", styles: { bold: true } };
    const { content } = convertTypedLinks([styled], resolve, NOTE_LINK_TYPE);
    expect(content[0]).toEqual({ type: "text", text: "a ", styles: { bold: true } });
    expect(content[2]).toEqual({ type: "text", text: " b", styles: { bold: true } });
  });

  it("is a no-op (no trailing space) when there is nothing to convert", () => {
    const { changed, content } = convertTypedLinks([text("plain text")], resolve, NOTE_LINK_TYPE);
    expect(changed).toBe(false);
    expect(content).toEqual([text("plain text")]);
  });
});
