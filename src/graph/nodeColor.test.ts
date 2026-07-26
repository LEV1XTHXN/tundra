import { describe, expect, it } from "vitest";
import { TAG_PALETTE } from "@/store/tagColors";
import { clusterColor, paletteAssigner } from "./nodeColor";

describe("paletteAssigner", () => {
  it("gives the same value the same color every time", () => {
    const assign = paletteAssigner(["Biology", "Chemistry", "Biology"]);
    expect(assign("Biology")).toBe(assign("Biology"));
  });

  it("gives different values (usually) different colors, sorted deterministically", () => {
    const assign = paletteAssigner(["Chemistry", "Biology", "Art"]);
    // Sorted: Art(0), Biology(1), Chemistry(2) — independent of input order.
    expect(assign("Art")).toBe(TAG_PALETTE[0]);
    expect(assign("Biology")).toBe(TAG_PALETTE[1]);
    expect(assign("Chemistry")).toBe(TAG_PALETTE[2]);
  });

  it("wraps around the palette once distinct values exceed its length", () => {
    const many = Array.from({ length: TAG_PALETTE.length + 2 }, (_, i) => `v${i}`);
    const assign = paletteAssigner(many);
    expect(assign("v0")).toBe(assign(`v${TAG_PALETTE.length}`));
  });

  it("assigns a stable color even for an unseen value (falls back to index 0)", () => {
    const assign = paletteAssigner(["Biology"]);
    expect(assign("Unknown")).toBe(TAG_PALETTE[0]);
  });
});

describe("clusterColor", () => {
  it("indexes the palette directly by community id", () => {
    expect(clusterColor(0)).toBe(TAG_PALETTE[0]);
    expect(clusterColor(1)).toBe(TAG_PALETTE[1]);
  });

  it("wraps around for a community id past the palette length", () => {
    expect(clusterColor(TAG_PALETTE.length)).toBe(TAG_PALETTE[0]);
  });
});
