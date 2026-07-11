/**
 * Pure helpers for applying a template to a note. Kept free of BlockNote and
 * `@tauri-apps/api` so they're trivially unit-testable; the editor calls them
 * with its live document / a template's stored blocks.
 *
 * A template's blocks are BlockNote documents (the same shape the core stores
 * for any note). Two operations are needed when inserting one into a note:
 *   - decide whether the target note is *blank* (so we replace vs. insert), and
 *   - strip every block's `id` so BlockNote assigns fresh, unique ones — without
 *     this, inserting the same template twice into one note would collide ids and
 *     `Note::validate` would reject the save (block ids must be unique per note).
 */

/** Minimal structural view of a stored/edited block — id optional so the same
 *  type covers both the input (with ids) and the id-stripped output. */
export interface RawBlock {
  id?: string;
  type: string;
  props?: unknown;
  content?: unknown;
  children?: RawBlock[];
}

/** BlockNote block types whose emptiness is decided purely by their text. Any
 *  other type (image/video/file/table/code/…) always counts as content. Mirrors
 *  `TEXT_BLOCK_TYPES` in the Rust `document` module so "blank" means the same
 *  thing on both sides. */
const TEXT_BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "quote",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "toggleListItem",
]);

/** Whether a BlockNote inline node carries meaningful content: any non-text
 *  inline (link, mention, custom) counts; a text node counts only if it has
 *  non-whitespace text. */
function inlineHasContent(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as { type?: unknown; text?: unknown; content?: unknown };
  if (n.type === "text" || (n.type === undefined && typeof n.text === "string")) {
    return typeof n.text === "string" && n.text.trim() !== "";
  }
  if (n.type === "link") return inlineContentHasContent(n.content);
  // Any other inline node (mention, custom inline embed) is content.
  return true;
}

function inlineContentHasContent(content: unknown): boolean {
  if (typeof content === "string") return content.trim() !== "";
  if (Array.isArray(content)) return content.some(inlineHasContent);
  return false;
}

/** Whether a single block (or any descendant) carries content. */
function blockHasContent(block: RawBlock): boolean {
  if (!TEXT_BLOCK_TYPES.has(block.type)) return true;
  if (inlineContentHasContent(block.content)) return true;
  return (block.children ?? []).some(blockHasContent);
}

/**
 * Whether a note body is "blank" — no meaningful content anywhere in the tree.
 * A freshly-created note (one empty paragraph) is blank; a note holding any
 * text, image, table, or other non-text block is not. Drives the smart-apply
 * decision: blank → replace the body with the template; otherwise → insert.
 */
export function isEmptyDocument(blocks: readonly RawBlock[]): boolean {
  return !blocks.some(blockHasContent);
}

/**
 * Deep-copy `blocks` with every `id` removed (recursively through `children`),
 * so BlockNote assigns fresh unique ids on insertion. Null/absent `props` and
 * `content` and empty `children` are dropped, matching what BlockNote expects of
 * a `PartialBlock`.
 */
export function stripBlockIds(blocks: readonly RawBlock[]): RawBlock[] {
  return blocks.map((b) => {
    const out: RawBlock = { type: b.type };
    if (b.props != null) out.props = b.props;
    if (b.content != null) out.content = b.content;
    if (b.children && b.children.length > 0) out.children = stripBlockIds(b.children);
    return out;
  });
}
