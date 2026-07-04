/**
 * Convert manually typed `[[Title]]` text into id-backed note-link nodes
 * (Phase 2 step 3, bug fix). The `[[` suggestion menu is the primary authoring
 * path, but a user can also just type the whole `[[Title]]` literally (or paste
 * it) — and the two-character `[[` trigger doesn't always fire on WebKitGTK. So
 * we also scan a block's inline content on change and upgrade any completed
 * `[[Title]]` whose title resolves to an existing note into a link node.
 *
 * This is the SAME one-time title→id capture the menu does at insertion — it is
 * NOT title→id resolution at read time (links are still stored and derived by
 * UUID; see the links preamble). A `[[Title]]` whose title matches no note is
 * left as literal text. Pure + editor-agnostic so it's unit-testable without
 * standing up BlockNote.
 */

/** A BlockNote inline text node. */
export interface TextInline {
  type: "text";
  text: string;
  styles?: Record<string, unknown>;
}

/** Any inline content node — text, our `noteLink`, or another opaque inline. */
export type Inline = TextInline | { type: string; [key: string]: unknown };

/** A resolved link target: the note's id plus its current title (stored as the
 *  link's fallback label, exactly like the menu path uses `n.title`). */
export interface LinkTarget {
  id: string;
  title: string;
}

// A completed `[[...]]` with no brackets inside — global so we can find every
// occurrence in a text run.
const PATTERN = /\[\[([^[\]]+)\]\]/g;

/**
 * Return the block content with every resolvable `[[Title]]` replaced by a link
 * node, and whether anything changed. Unresolved `[[Title]]` and all non-text
 * nodes (including existing links) are preserved verbatim. When the result ends
 * on a link node, a trailing space is appended so the caret has editable text to
 * land in after the atomic link — matching the menu, which inserts a trailing space.
 */
export function convertTypedLinks(
  content: readonly Inline[],
  resolveTitle: (title: string) => LinkTarget | undefined,
  linkType: string,
): { changed: boolean; content: Inline[] } {
  let changed = false;
  const out: Inline[] = [];

  for (const item of content) {
    if (!isText(item)) {
      out.push(item);
      continue;
    }

    const styles = item.styles ?? {};
    const pieces: Inline[] = [];
    let last = 0;
    let localChanged = false;
    PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PATTERN.exec(item.text))) {
      const target = resolveTitle(match[1].trim());
      if (!target) continue; // no such note — leave the literal text as-is
      if (match.index > last) {
        pieces.push({ type: "text", text: item.text.slice(last, match.index), styles });
      }
      pieces.push({ type: linkType, props: { noteId: target.id, label: target.title, display: "" } });
      last = match.index + match[0].length;
      localChanged = true;
    }

    if (!localChanged) {
      out.push(item);
      continue;
    }
    if (last < item.text.length) {
      pieces.push({ type: "text", text: item.text.slice(last), styles });
    }
    out.push(...pieces);
    changed = true;
  }

  if (changed) {
    const lastItem = out[out.length - 1];
    if (lastItem && lastItem.type === linkType) {
      out.push({ type: "text", text: " ", styles: {} });
    }
  }

  return { changed, content: out };
}

function isText(item: Inline): item is TextInline {
  return item.type === "text" && typeof (item as TextInline).text === "string";
}
