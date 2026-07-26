import type { Block } from "@/services";

/** Plain text out of one block's `content` (BlockNote's inline-content array —
 *  opaque JSON to the core, so this walks it defensively rather than trusting
 *  a schema). Recurses into a link's own `content` so `[label](url)` text
 *  still contributes, same shape import adapters already rely on. */
function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const c = item as { text?: unknown; content?: unknown };
      if (typeof c.text === "string") return c.text;
      if (Array.isArray(c.content)) return inlineText(c.content);
      return "";
    })
    .join("");
}

/**
 * A short plain-text preview of a note's first non-empty lines — the Gallery
 * card's "1-2 line preview" (`FolderGallery.tsx`). Walks the block tree
 * (including nested children, e.g. a bullet list's items) collecting text
 * until `maxLen`, then truncates with an ellipsis. Table/tableContent blocks
 * and pure-media blocks (image/video, no text content) simply contribute
 * nothing — never thrown on, so an unusual block type degrades to "just skip it."
 */
export function notePreview(blocks: Block[] | undefined, maxLen = 160): string {
  const parts: string[] = [];
  let length = 0;

  function walk(list: Block[] | undefined) {
    if (!list) return;
    for (const block of list) {
      if (length >= maxLen) return;
      const text = inlineText(block.content).trim();
      if (text) {
        parts.push(text);
        length += text.length + 1;
      }
      walk(block.children);
      if (length >= maxLen) return;
    }
  }

  walk(blocks);
  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  return joined.length > maxLen ? `${joined.slice(0, maxLen).trimEnd()}…` : joined;
}
