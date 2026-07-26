import { describe, expect, it } from "vitest";
import type { Block } from "@/services";
import { notePreview } from "./notePreview";

function paragraph(text: string, children: Block[] = []): Block {
  return {
    id: crypto.randomUUID(),
    type: "paragraph",
    content: [{ type: "text", text, styles: {} }],
    children,
  } as unknown as Block;
}

describe("notePreview", () => {
  it("returns empty string for a note with no blocks", () => {
    expect(notePreview(undefined)).toBe("");
    expect(notePreview([])).toBe("");
  });

  it("joins text across the first few blocks", () => {
    const blocks = [paragraph("First line."), paragraph("Second line.")];
    expect(notePreview(blocks)).toBe("First line. Second line.");
  });

  it("skips blocks with no text content (e.g. an image) without throwing", () => {
    const image: Block = {
      id: "img1",
      type: "image",
      props: { url: "attachments/images/a.png" },
      content: undefined,
      children: [],
    } as unknown as Block;
    const blocks = [image, paragraph("Real text after the image.")];
    expect(notePreview(blocks)).toBe("Real text after the image.");
  });

  it("recurses into nested children (e.g. a list item)", () => {
    const blocks = [paragraph("", [paragraph("Nested item text.")])];
    expect(notePreview(blocks)).toBe("Nested item text.");
  });

  it("truncates with an ellipsis past maxLen", () => {
    const longText = "a".repeat(50);
    const blocks = [paragraph(longText)];
    const preview = notePreview(blocks, 20);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(21);
  });

  it("resolves a link's own inline content", () => {
    const link: Block = {
      id: "b1",
      type: "paragraph",
      content: [{ type: "link", href: "x.md", content: [{ type: "text", text: "Linked text", styles: {} }] }],
      children: [],
    } as unknown as Block;
    expect(notePreview([link])).toBe("Linked text");
  });
});
