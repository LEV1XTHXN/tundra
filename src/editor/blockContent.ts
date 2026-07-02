import type { PartialBlock } from "@blocknote/core";

/** A fresh, empty BlockNote document — one empty paragraph. */
export function emptyDocument(): PartialBlock[] {
  return [{ type: "paragraph" }];
}

/**
 * Phase 0's walking skeleton stored the first block's `content` as a raw
 * string — not BlockNote's shape (an array of inline content nodes, or
 * undefined for an empty block). Narrowly detect that (and anything else
 * that obviously isn't a BlockNote block array) and fall back to an empty
 * document instead of handing BlockNote something it can't render.
 */
export function toInitialContent(blocks: unknown): PartialBlock[] {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return emptyDocument();
  }
  const looksLikeBlockNote = blocks.every((b) => {
    if (!b || typeof b !== "object") return false;
    const block = b as { id?: unknown; type?: unknown; content?: unknown };
    return typeof block.id === "string" && typeof block.type === "string" && typeof block.content !== "string";
  });
  if (!looksLikeBlockNote) {
    console.warn(
      "[editor] note has a non-BlockNote block shape (likely the Phase 0 skeleton) — resetting to an empty document instead of crashing",
      blocks,
    );
    return emptyDocument();
  }
  return blocks as PartialBlock[];
}
