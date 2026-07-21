import { describe, expect, it } from "vitest";
import { mergeNote } from "./noteMerge";
import type { Banner, Note } from "@/services";

function baseNote(overrides: Partial<Note> = {}): Note {
  return {
    schemaVersion: 1,
    id: "n1",
    title: "Original",
    created: "2026-07-01T10:00:00Z",
    modified: "2026-07-01T10:00:00Z",
    meta: { pinned: false, tags: ["bio"] },
    blocks: [{ id: "b1", type: "paragraph", content: [] }],
    ...overrides,
  } as Note;
}

describe("mergeNote", () => {
  it("rewrites title + blocks without touching icon or meta", () => {
    const base = baseNote({ icon: { type: "emoji", value: "1f331" } });
    const next = mergeNote(base, { title: "New", blocks: [{ id: "b2", type: "heading" }] as Note["blocks"] });
    expect(next.title).toBe("New");
    expect(next.blocks).toEqual([{ id: "b2", type: "heading" }]);
    expect(next.icon).toEqual({ type: "emoji", value: "1f331" });
    expect(next.meta).toEqual(base.meta);
  });

  it("leaves absent keys untouched", () => {
    const base = baseNote();
    const next = mergeNote(base, {});
    expect(next).toEqual(base);
  });

  it("sets the icon when the key is present", () => {
    const next = mergeNote(baseNote(), { icon: { type: "emoji", value: "2764" } });
    expect(next.icon).toEqual({ type: "emoji", value: "2764" });
  });

  it("clears the icon when the key is present but undefined", () => {
    const base = baseNote({ icon: { type: "emoji", value: "1f331" } });
    const next = mergeNote(base, { icon: undefined });
    expect(next.icon).toBeUndefined();
  });

  it("folds pinned into meta, preserving other meta fields", () => {
    const next = mergeNote(baseNote(), { pinned: true });
    expect(next.meta).toEqual({ pinned: true, tags: ["bio"] });
  });

  it("folds banner into meta and clears it with undefined", () => {
    const banner: Banner = { type: "gradient", value: "sunset" };
    const withBanner = mergeNote(baseNote(), { banner });
    expect((withBanner.meta as { banner?: unknown }).banner).toEqual(banner);
    const cleared = mergeNote(withBanner, { banner: undefined });
    expect((cleared.meta as { banner?: unknown }).banner).toBeUndefined();
  });

  it("supplies the default meta when the base has none", () => {
    const base = baseNote({ meta: undefined as unknown as Note["meta"] });
    const next = mergeNote(base, { pinned: true });
    expect(next.meta).toEqual({ pinned: true, tags: [] });
  });
});
