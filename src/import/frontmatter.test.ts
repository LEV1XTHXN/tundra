import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter";

describe("parseFrontmatter — no frontmatter", () => {
  it("returns the body unchanged and empty frontmatter when there's no --- block", () => {
    const { frontmatter, body } = parseFrontmatter("# Just a heading\n\nSome text.");
    expect(frontmatter.raw).toEqual({});
    expect(frontmatter.tags).toEqual([]);
    expect(body).toBe("# Just a heading\n\nSome text.");
  });
});

describe("parseFrontmatter — Obsidian conventions", () => {
  it("parses a flow list for tags and a scalar title", () => {
    const { frontmatter, body } = parseFrontmatter(
      '---\ntitle: Welcome Home\ntags: [intro, demo]\n---\n\n# Welcome\n',
    );
    expect(frontmatter.title).toBe("Welcome Home");
    expect(frontmatter.tags).toEqual(["intro", "demo"]);
    expect(body).toBe("\n# Welcome\n");
  });

  it("parses a block list and the singular tag: key", () => {
    const { frontmatter } = parseFrontmatter("---\ntags:\n  - biology\n  - science\ntag: extra\n---\nBody.");
    expect(frontmatter.tags.sort()).toEqual(["biology", "extra", "science"]);
  });

  it("detects a plugin marker key (e.g. kanban-plugin) via raw", () => {
    const { frontmatter } = parseFrontmatter("---\nkanban-plugin: basic\n---\nBody.");
    expect(frontmatter.raw["kanban-plugin"]).toBe("basic");
  });
});

describe("parseFrontmatter — Anytype conventions (verified against a real export)", () => {
  const anytypeNote = [
    "---",
    "# yaml-language-server: $schema=schemas/character.schema.json",
    "Object type:",
    "    - Character",
    'Creation date: "2025-08-20T16:04:11Z"',
    "Created by:",
    "    - Sirsi",
    "id: bafyreigr4eypscbbxo6clptohbvuo3xfuyh6x2ykgaqevtf4hi2dlmoyl4",
    "---",
    "# Gottfried",
    "Body text.",
  ].join("\n");

  it("skips the leading yaml-language-server comment line without misparsing it", () => {
    const { frontmatter } = parseFrontmatter(anytypeNote);
    expect(Object.keys(frontmatter.raw)).not.toContain("# yaml-language-server");
  });

  it("parses multi-word relation names (spaces in the key, unlike Obsidian's single-word keys)", () => {
    const { frontmatter } = parseFrontmatter(anytypeNote);
    expect(frontmatter.raw["Object type"]).toEqual(["Character"]);
    expect(frontmatter.raw["Creation date"]).toBe("2025-08-20T16:04:11Z");
    expect(frontmatter.raw["Created by"]).toEqual(["Sirsi"]);
    expect(frontmatter.raw.id).toBe("bafyreigr4eypscbbxo6clptohbvuo3xfuyh6x2ykgaqevtf4hi2dlmoyl4");
  });

  it("leaves the body completely intact after the closing ---", () => {
    const { body } = parseFrontmatter(anytypeNote);
    expect(body).toBe("# Gottfried\nBody text.");
  });

  it("detects a capitalized Tag: relation case-insensitively, unlike Obsidian's lowercase tags", () => {
    const withTag = [
      "---",
      "Object type:",
      "    - Location",
      "Tag:",
      "    - Drachenholt",
      "    - Province",
      "---",
      "Body.",
    ].join("\n");
    const { frontmatter } = parseFrontmatter(withTag);
    expect(frontmatter.tags.sort()).toEqual(["Drachenholt", "Province"]);
    // The original casing is preserved in `raw` for adapters that need it.
    expect(frontmatter.raw.Tag).toEqual(["Drachenholt", "Province"]);
  });

  it("parses a single-value Tag: relation the same as a multi-value one", () => {
    const { frontmatter } = parseFrontmatter("---\nTag:\n    - System Page\n---\nBody.");
    expect(frontmatter.tags).toEqual(["System Page"]);
  });
});
