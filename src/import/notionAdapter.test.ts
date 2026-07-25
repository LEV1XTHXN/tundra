import { beforeEach, describe, expect, it } from "vitest";
import type { Block, SourceFile } from "@/services";
import { notionAdapter } from "./notionAdapter";
import type { ResolvedNote } from "./types";

// 32-hex Notion ids — verified format (a space, then 32 hex chars) against a
// real export via `notion2obsidian`'s regex/test fixtures (read only as a
// reference; not used, vendored, or required by this app — see
// notionAdapter.ts's doc comment).
const ID_A = "a".repeat(32);
const ID_B = "b".repeat(32);
const ID_MISSING = "c".repeat(32);

// `prepare()` populates module-level state (which paths are containers) that
// `preprocessNote` reads — reset it before every test so declaration order
// never matters; a test that needs containers calls `prepare()` itself.
beforeEach(() => notionAdapter.prepare?.([]));

describe("notionAdapter.classify", () => {
  it("treats .md and .csv as notes, media by extension, everything else as a generic file", () => {
    expect(notionAdapter.classify({ rel_path: `Project Alpha ${ID_A}.md` })).toEqual({ kind: "note" });
    expect(notionAdapter.classify({ rel_path: `Tasks ${ID_A}_all.csv` })).toEqual({ kind: "note" });
    expect(notionAdapter.classify({ rel_path: "Project Alpha/diagram.png" })).toEqual({
      kind: "attachment",
      attachmentKind: "image",
    });
    expect(notionAdapter.classify({ rel_path: "Project Alpha/clip.mov" })).toEqual({
      kind: "attachment",
      attachmentKind: "video",
    });
    expect(notionAdapter.classify({ rel_path: "Project Alpha/notes.pdf" })).toEqual({
      kind: "attachment",
      attachmentKind: "file",
    });
  });
});

describe("notionAdapter.preprocessNote — titles and hierarchy", () => {
  it("strips the trailing 32-hex id to get a clean title", () => {
    const pre = notionAdapter.preprocessNote(`Project Alpha ${ID_A}.md`, "Some content.");
    expect(pre.title).toBe("Project Alpha");
  });

  it("derives the destination folder from existing (already id-less) parent path segments", () => {
    // Verified on a real export: a folder is named the CLEAN title only, with
    // NO id (unlike the file beside it) — so a leaf note's parent segments
    // never carry an id to strip in the first place.
    const pre = notionAdapter.preprocessNote(`Project Alpha/Tasks ${ID_B}.md`, "Some content.");
    expect(pre.title).toBe("Tasks");
    expect(pre.folder).toBe("Project Alpha");
  });

  it("preserves multi-level nesting (a database's row folder inside a page's children folder)", () => {
    const pre = notionAdapter.preprocessNote(
      `Projects/Tasks/Buy milk ${ID_MISSING}.md`,
      "Some content.",
    );
    expect(pre.folder).toBe("Projects/Tasks");
  });
});

describe("notionAdapter.preprocessNote — CSV databases", () => {
  const csvText = 'Name,Status\n"Buy milk",Done\n"Ship it","In progress"\n';

  it("synthesizes a Markdown table from the CSV and flags reduced fidelity", () => {
    const pre = notionAdapter.preprocessNote(`Tasks ${ID_A}_all.csv`, csvText);
    expect(pre.title).toBe("Tasks");
    expect(pre.body).toContain("| Name | Status |");
    expect(pre.body).toContain("| Buy milk | Done |");
    expect(pre.body).toContain("| Ship it | In progress |");
    expect(pre.flags?.note).toMatch(/database/i);
    expect(pre.flags?.note).toMatch(/filters.*sorts.*rollups|formulas/i);
  });
});

describe("notionAdapter.preprocessNote — external file links", () => {
  it("flags a note containing a Notion-hosted (signed URL) file embed", () => {
    const pre = notionAdapter.preprocessNote(
      `Page ${ID_A}.md`,
      "See the diagram:\n\n![diagram](https://prod-files-secure.s3.us-west-2.amazonaws.com/abc/diagram.png)\n",
    );
    expect(pre.flags?.note).toMatch(/expire|external/i);
  });

  it("does not flag a note with only local relative references", () => {
    const pre = notionAdapter.preprocessNote(`Page ${ID_A}.md`, "See ![diagram](diagram.png) below.");
    expect(pre.flags).toBeUndefined();
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

describe("notionAdapter.resolveNote — internal links (resolved by Notion id)", () => {
  it("resolves an internal Markdown link to a noteLink using the pass-1 id map", () => {
    const targetRel = `Tasks ${ID_B}`; // pipeline.ts registers by stripExt(basename(relPath)).toLowerCase()
    const noteIdMap = new Map<string, ResolvedNote>([[targetRel.toLowerCase(), { id: "note-123", title: "Tasks" }]]);
    const blocks = [
      paragraph("p1", [textItem("See "), linkItem(`Tasks%20${ID_B}.md`, "Tasks"), textItem(".")]),
    ];

    const result = notionAdapter.resolveNote(blocks, [], noteIdMap, new Map(), `Projects ${ID_A}.md`);

    expect(result.unresolvedLinks).toBe(0);
    const content = result.blocks[0].content as unknown as { type: string; props?: { noteId: string } }[];
    const link = content.find((c) => c.type === "noteLink");
    expect(link?.props?.noteId).toBe("note-123");
  });

  it("keeps a custom link label as the display alias when it differs from the resolved title", () => {
    const targetRel = `Tasks ${ID_B}`;
    const noteIdMap = new Map<string, ResolvedNote>([[targetRel.toLowerCase(), { id: "note-123", title: "Tasks" }]]);
    const blocks = [paragraph("p1", [linkItem(`Tasks%20${ID_B}.md`, "the task list")])];

    const result = notionAdapter.resolveNote(blocks, [], noteIdMap, new Map(), `Projects ${ID_A}.md`);

    const content = result.blocks[0].content as unknown as { props?: { display: string } }[];
    expect(content[0].props?.display).toBe("the task list");
  });

  it("reverts an unresolvable internal link to plain text and counts it in the report", () => {
    const blocks = [paragraph("p1", [linkItem(`Missing%20${ID_MISSING}.md`, "Missing Page")])];

    const result = notionAdapter.resolveNote(blocks, [], new Map(), new Map(), `Projects ${ID_A}.md`);

    expect(result.unresolvedLinks).toBe(1);
    const content = result.blocks[0].content as unknown as { type: string; text?: string }[];
    expect(content[0]).toEqual({ type: "text", text: "Missing Page", styles: {} });
  });

  it("leaves a genuinely external link untouched", () => {
    const blocks = [paragraph("p1", [linkItem("https://example.com", "Example")])];

    const result = notionAdapter.resolveNote(blocks, [], new Map(), new Map(), `Projects ${ID_A}.md`);

    expect(result.unresolvedLinks).toBe(0);
    expect(result.blocks[0].content).toEqual(blocks[0].content);
  });
});

describe("notionAdapter.resolveNote — attachments", () => {
  it("rewrites a resolved relative image reference to the copied vault-relative path", () => {
    // Notion image refs are relative to the LINKING page's own folder — the
    // attachment map is keyed by the source-root-relative path (matching
    // pipeline.ts's registration), so resolution must account for that folder.
    // The folder itself carries no id (verified against a real export).
    const attachmentMap = new Map([[`projects/diagram.png`, "attachments/images/aa/hash.png"]]);
    const blocks = [imageBlock("img1", "diagram.png", "diagram.png")];

    const result = notionAdapter.resolveNote(
      blocks,
      [],
      new Map(),
      attachmentMap,
      `Projects/Page ${ID_B}.md`,
    );

    expect(result.unresolvedAttachments).toBe(0);
    expect(result.blocks[0].type).toBe("image");
    expect((result.blocks[0].props as { url: string }).url).toBe("attachments/images/aa/hash.png");
  });

  it("reverts an unresolved image reference to a visible placeholder and counts it", () => {
    const blocks = [imageBlock("img1", "missing.png", "missing.png")];

    const result = notionAdapter.resolveNote(blocks, [], new Map(), new Map(), `Projects/Page ${ID_B}.md`);

    expect(result.unresolvedAttachments).toBe(1);
    expect(result.blocks[0].type).toBe("paragraph");
    const content = result.blocks[0].content as unknown as { text: string }[];
    expect(content[0].text).toContain("missing.png");
  });

  it("leaves an absolute (signed Notion) file URL untouched, never counted as unresolved", () => {
    const blocks = [imageBlock("img1", "https://prod-files-secure.example.com/x/diagram.png", "diagram.png")];

    const result = notionAdapter.resolveNote(blocks, [], new Map(), new Map(), `Projects ${ID_A}.md`);

    expect(result.unresolvedAttachments).toBe(0);
    expect(result.blocks[0].type).toBe("image");
    expect((result.blocks[0].props as { url: string }).url).toBe(
      "https://prod-files-secure.example.com/x/diagram.png",
    );
  });
});

describe("notionAdapter — hierarchy mapping (Notion has no folders, only page nesting)", () => {
  const ID_PARENT = "1".repeat(32);
  const ID_CHILD_A = "2".repeat(32);
  const ID_CHILD_B = "3".repeat(32);

  // A page with two children: "Projects <id>.md" plus a sibling folder named
  // the CLEAN TITLE ONLY — "Projects/", no id — holding "Alpha <id>.md" and
  // "Beta <id>.md". Verified against a real "Include subpages" export: the
  // folder never carries the id, only the files inside/beside it do.
  const files: SourceFile[] = [
    { rel_path: `Projects ${ID_PARENT}.md` },
    { rel_path: `Projects/Alpha ${ID_CHILD_A}.md` },
    { rel_path: `Projects/Beta ${ID_CHILD_B}.md` },
  ];

  it("turns the parent page into a folder + index note, and lands children inside it", () => {
    notionAdapter.prepare?.(files);

    const parent = notionAdapter.preprocessNote(`Projects ${ID_PARENT}.md`, "The projects overview.");
    expect(parent.title).toBe("Projects");
    expect(parent.folder).toBe("Projects"); // index note lives INSIDE its own folder, not beside it
    expect(parent.isContainerIndex).toBe(true);
    expect(parent.body).toBe("The projects overview."); // verbatim — no synthetic wrapper text

    const childA = notionAdapter.preprocessNote(`Projects/Alpha ${ID_CHILD_A}.md`, "Alpha's content.");
    expect(childA.title).toBe("Alpha");
    expect(childA.folder).toBe("Projects"); // sibling of the index note, same folder
    expect(childA.isContainerIndex).toBeFalsy();

    const childB = notionAdapter.preprocessNote(`Projects/Beta ${ID_CHILD_B}.md`, "Beta's content.");
    expect(childB.folder).toBe("Projects");
  });

  it("resolves a link to the parent page to its INDEX NOTE, never a folder", () => {
    notionAdapter.prepare?.(files);
    const parent = notionAdapter.preprocessNote(`Projects ${ID_PARENT}.md`, "Overview.");

    // Mirrors pipeline.ts's pass-1 registration: keyed by the source file's
    // own basename (extension stripped, lowercased) — independent of which
    // Tundra folder `parent.folder` ended up placing the note in.
    const noteIdMap = new Map<string, ResolvedNote>([
      [`Projects ${ID_PARENT}`.toLowerCase(), { id: "index-note-id", title: parent.title }],
    ]);

    const blocks = [paragraph("p1", [linkItem(`../Projects%20${ID_PARENT}.md`, "back to Projects")])];
    const result = notionAdapter.resolveNote(
      blocks,
      [],
      noteIdMap,
      new Map(),
      `Projects/Alpha ${ID_CHILD_A}.md`,
    );

    expect(result.unresolvedLinks).toBe(0);
    const content = result.blocks[0].content as unknown as { type: string; props?: { noteId: string } }[];
    expect(content[0]).toMatchObject({ type: "noteLink", props: { noteId: "index-note-id" } });
  });
});
