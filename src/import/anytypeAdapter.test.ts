import { describe, expect, it } from "vitest";
import type { Block } from "@/services";
import { anytypeAdapter } from "./anytypeAdapter";
import type { ResolvedNote } from "./types";

// Fixtures modeled directly on a REAL Anytype Markdown export (a ~130-object
// campaign vault) — see anytypeAdapter.ts's doc comment for what was verified.

describe("anytypeAdapter.classify", () => {
  it("treats .md as a note, schemas/*.json and other JSON as distinct skip reasons", () => {
    expect(anytypeAdapter.classify({ rel_path: "gotfrid.md" })).toEqual({ kind: "note" });
    expect(anytypeAdapter.classify({ rel_path: "schemas/character.schema.json" })).toEqual({
      kind: "skip",
      reason: "Anytype relation schema definition (not user content)",
    });
    expect(anytypeAdapter.classify({ rel_path: "export.json" })).toEqual({
      kind: "skip",
      reason: "Any-Block JSON export (out of scope for v1)",
    });
  });

  it("classifies files/ attachments by extension", () => {
    expect(anytypeAdapter.classify({ rel_path: "files/city2.jpg" })).toEqual({
      kind: "attachment",
      attachmentKind: "image",
    });
    expect(anytypeAdapter.classify({ rel_path: "files/clip.mov" })).toEqual({
      kind: "attachment",
      attachmentKind: "video",
    });
    expect(anytypeAdapter.classify({ rel_path: "files/notes.pdf" })).toEqual({
      kind: "attachment",
      attachmentKind: "file",
    });
  });
});

describe("anytypeAdapter.preprocessNote — title and tags", () => {
  const gotfridMd = [
    "---",
    "# yaml-language-server: $schema=schemas/character.schema.json",
    "Object type:",
    "    - Character",
    'Creation date: "2025-08-20T16:04:11Z"',
    "Created by:",
    "    - Sirsi",
    "id: bafyreigr4eypscbbxo6clptohbvuo3xfuyh6x2ykgaqevtf4hi2dlmoyl4",
    "---",
    "# Готфрид   ",
    "Вор, который вместе со своей командой решил ограбить городское хранилище.",
  ].join("\n");

  it("takes the title from the first H1 when frontmatter has no title/name relation", () => {
    const pre = anytypeAdapter.preprocessNote("gotfrid.md", gotfridMd);
    expect(pre.title).toBe("Готфрид");
  });

  it("falls back to the filename when there's no frontmatter title AND no H1", () => {
    const pre = anytypeAdapter.preprocessNote("plain-note.md", "Just some body text, no heading.");
    expect(pre.title).toBe("plain-note");
  });

  it("maps the capitalized, singular Tag: relation to note tags", () => {
    const nordmarkMd = [
      "---",
      "Object type:",
      "    - Location",
      "Tag:",
      "    - Drachenholt",
      "    - Province",
      "---",
      "# Нордмарк",
      "Body.",
    ].join("\n");
    const pre = anytypeAdapter.preprocessNote("nordmark.md", nordmarkMd);
    expect(pre.tags.sort()).toEqual(["Drachenholt", "Province"]);
  });
});

describe("anytypeAdapter.preprocessNote — non-tag relations preserved as properties", () => {
  it("renders every other relation as a bullet list prepended to the body, verbatim body kept intact", () => {
    const md = [
      "---",
      "Object type:",
      "    - Character",
      'Creation date: "2025-08-20T16:04:11Z"',
      "Created by:",
      "    - Sirsi",
      "id: bafyreigr4eypscbbxo6clptohbvuo3xfuyh6x2ykgaqevtf4hi2dlmoyl4",
      "---",
      "# Готфрид",
      "Original body text.",
    ].join("\n");
    const pre = anytypeAdapter.preprocessNote("gotfrid.md", md);

    expect(pre.body).toContain("**Creation date:** 2025-08-20T16:04:11Z");
    expect(pre.body).toContain("**Created by:** Sirsi");
    expect(pre.body).toContain("**id:** bafyreigr4eypscbbxo6clptohbvuo3xfuyh6x2ykgaqevtf4hi2dlmoyl4");
    expect(pre.body).toContain("Original body text.");
    // Object type and tags are both spent elsewhere (folder, note tags) —
    // neither leaks into the properties list.
    expect(pre.body).not.toContain("Object type");
    expect(pre.body).not.toContain("Tag");
  });

  it("groups the note into a folder named after its Object type relation", () => {
    const md = ["---", "Object type:", "    - Character", "---", "# Готфрид", "Body."].join("\n");
    const pre = anytypeAdapter.preprocessNote("gotfrid.md", md);
    expect(pre.folder).toBe("Character");
  });

  it("falls back to no folder when there's no Object type relation", () => {
    const pre = anytypeAdapter.preprocessNote("plain.md", "# Plain\nJust body text.");
    expect(pre.folder).toBe("");
  });

  it("omits the properties block entirely when a note has no frontmatter", () => {
    const pre = anytypeAdapter.preprocessNote("plain.md", "# Plain\nJust body text.");
    expect(pre.body).toBe("# Plain\nJust body text.");
  });
});

function textItem(text: string) {
  return { type: "text", text, styles: {} };
}

function paragraph(id: string, content: unknown[]): Block {
  return { id, type: "paragraph", props: {}, content, children: [] } as unknown as Block;
}

function linkItem(href: string, text: string) {
  return { type: "link", href, content: [textItem(text)] };
}

function imageBlock(id: string, url: string, name: string): Block {
  return { id, type: "image", props: { url, name }, content: undefined, children: [] } as unknown as Block;
}

describe("anytypeAdapter.resolveNote — inter-object links (no id, resolved by path)", () => {
  it("resolves a [label](target.md) link to a noteLink via the pass-1 map", () => {
    const noteIdMap = new Map<string, ResolvedNote>([
      ["drachenholt-empire", { id: "note-123", title: "Drachenholt Empire" }],
    ]);
    const blocks = [paragraph("p1", [linkItem("drachenholt-empire.md", "Drachenholt Empire")])];

    const result = anytypeAdapter.resolveNote(blocks, [], noteIdMap, new Map(), "world.md");

    expect(result.unresolvedLinks).toBe(0);
    const content = result.blocks[0].content as unknown as { type: string; props?: { noteId: string } }[];
    expect(content[0]).toMatchObject({ type: "noteLink", props: { noteId: "note-123" } });
  });

  it("reverts an unresolvable link to plain text and counts it", () => {
    const blocks = [paragraph("p1", [linkItem("some-deleted-object.md", "Some Deleted Object")])];

    const result = anytypeAdapter.resolveNote(blocks, [], new Map(), new Map(), "world.md");

    expect(result.unresolvedLinks).toBe(1);
    const content = result.blocks[0].content as unknown as { type: string; text?: string }[];
    expect(content[0]).toEqual({ type: "text", text: "Some Deleted Object", styles: {} });
  });

  it("leaves a genuinely external link untouched", () => {
    const blocks = [paragraph("p1", [linkItem("https://example.com", "Example")])];

    const result = anytypeAdapter.resolveNote(blocks, [], new Map(), new Map(), "world.md");

    expect(result.unresolvedLinks).toBe(0);
    expect(result.blocks[0].content).toEqual(blocks[0].content);
  });

  it("leaves a non-.md relative link (not an object reference) untouched", () => {
    const blocks = [paragraph("p1", [linkItem("#some-anchor", "Section")])];
    const result = anytypeAdapter.resolveNote(blocks, [], new Map(), new Map(), "world.md");
    expect(result.unresolvedLinks).toBe(0);
    expect(result.blocks[0].content).toEqual(blocks[0].content);
  });
});

describe("anytypeAdapter.resolveNote — attachments (files/ folder)", () => {
  it("rewrites a resolved files/ image reference to the copied vault-relative path", () => {
    const attachmentMap = new Map([["files/city2.jpg", "attachments/images/aa/hash.jpg"]]);
    const blocks = [imageBlock("img1", "files/city2.jpg", "city2")];

    const result = anytypeAdapter.resolveNote(blocks, [], new Map(), attachmentMap, "daliokii-mir.md");

    expect(result.unresolvedAttachments).toBe(0);
    expect(result.blocks[0].type).toBe("image");
    expect((result.blocks[0].props as { url: string }).url).toBe("attachments/images/aa/hash.jpg");
  });

  it("reverts an unresolved attachment reference to a visible placeholder and counts it", () => {
    const blocks = [imageBlock("img1", "files/missing.jpg", "missing")];

    const result = anytypeAdapter.resolveNote(blocks, [], new Map(), new Map(), "daliokii-mir.md");

    expect(result.unresolvedAttachments).toBe(1);
    expect(result.blocks[0].type).toBe("paragraph");
    const content = result.blocks[0].content as unknown as { text: string }[];
    expect(content[0].text).toContain("missing");
  });
});
