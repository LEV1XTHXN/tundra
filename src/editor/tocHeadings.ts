/**
 * Derive the note's table-of-contents entries from its block tree: one entry per
 * non-empty heading block, in document order, with its level and visible text.
 *
 * Pure and editor-agnostic — it walks the opaque block JSON the same way
 * `noteStats.ts` and the Rust `links` parser do, so it's unit-testable and never
 * depends on a live editor instance. Not a source of truth; the TOC overlay
 * recomputes it from the current `editor.document` whenever the note changes.
 */
import { NOTE_LINK_TYPE } from "./NoteLink";

export interface TocHeading {
  /** The heading block's stable id — matches its `data-id` in the editor DOM. */
  id: string;
  /** Heading level (1–3 for BlockNote's default schema; clamped to ≥ 1). */
  level: number;
  /** Visible heading text (whitespace collapsed), used as the TOC label. */
  text: string;
}

/** Pull the visible text out of a heading's inline content (text runs and
 *  `noteLink` nodes, whose label lives in props). Mirrors
 *  `noteStats.collectInline` but only what a heading label needs. */
function collectInline(content: unknown): string {
  let out = "";
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    if (obj.type === NOTE_LINK_TYPE) {
      const props = obj.props as Record<string, unknown> | undefined;
      out += ` ${(props?.display as string) || (props?.label as string) || ""} `;
      return; // the label lives in props; don't descend
    }
    if (obj.type === "text" && typeof obj.text === "string") {
      out += obj.text;
    }
    for (const [key, nested] of Object.entries(obj)) {
      if (key === "props" || key === "styles") continue;
      if (nested && typeof nested === "object") visit(nested);
    }
  };
  visit(content);
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Every non-empty heading in `blocks`, in document order. Walks children too, so
 * headings nested inside columns/toggles still surface. Empty headings (no
 * visible text) are skipped — they'd render as blank, unclickable TOC rows.
 */
export function extractHeadings(blocks: unknown): TocHeading[] {
  const headings: TocHeading[] = [];

  const walk = (block: unknown): void => {
    if (!block || typeof block !== "object") return;
    const b = block as Record<string, unknown>;
    if (b.type === "heading" && typeof b.id === "string") {
      const props = b.props as Record<string, unknown> | undefined;
      const rawLevel = typeof props?.level === "number" ? props.level : 1;
      const text = collectInline(b.content);
      if (text) headings.push({ id: b.id, level: Math.max(1, rawLevel), text });
    }
    if (Array.isArray(b.children)) b.children.forEach(walk);
  };

  if (Array.isArray(blocks)) blocks.forEach(walk);
  return headings;
}
