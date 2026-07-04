/**
 * Cheap, derived stats about a note's block tree for the metadata inspector:
 * word/character counts and how many outgoing note links it has. Pure and
 * editor-agnostic (walks the opaque block JSON the same way the Rust `links`
 * parser does), so it's unit-testable and reusable. Not a source of truth —
 * recomputed from the current blocks whenever the inspector refreshes.
 */
import { NOTE_LINK_TYPE } from "./NoteLink";

export interface NoteStats {
  words: number;
  /** Visible-text length (whitespace collapsed) — an approximation, not bytes. */
  characters: number;
  /** Number of outgoing note-link nodes (`[[links]]`) in the note. */
  linksOut: number;
}

export function noteStats(blocks: unknown): NoteStats {
  let linksOut = 0;
  // One string per block so adjacent blocks' words don't fuse ("world"+"three").
  const blockTexts: string[] = [];

  // Pull the visible text out of one block's inline content (text runs, links,
  // and nested inline like hyperlinks / table cells).
  const collectInline = (content: unknown): string => {
    let out = "";
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== "object") return;
      const obj = value as Record<string, unknown>;
      if (obj.type === NOTE_LINK_TYPE) {
        linksOut += 1;
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
    return out;
  };

  const walkBlock = (block: unknown): void => {
    if (!block || typeof block !== "object") return;
    const b = block as Record<string, unknown>;
    if (b.content !== undefined) blockTexts.push(collectInline(b.content));
    if (Array.isArray(b.children)) b.children.forEach(walkBlock);
  };

  if (Array.isArray(blocks)) blocks.forEach(walkBlock);

  // Blocks are line-separated; collapse runs of whitespace for the counts.
  const clean = blockTexts.join("\n").replace(/\s+/g, " ").trim();
  return {
    words: clean === "" ? 0 : clean.split(" ").length,
    characters: clean.length,
    linksOut,
  };
}
