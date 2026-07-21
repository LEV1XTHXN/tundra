/**
 * Obsidian source adapter (step 1 of the multi-app import feature — see
 * `pipeline.ts`'s doc comment for the generic/adapter split). Everything here
 * is Obsidian-specific: which files are notes vs. attachments, frontmatter
 * conventions, and — the main correctness risk — `[[wikilinks]]`, which
 * BlockNote's Markdown parser doesn't understand at all.
 *
 * Wikilink strategy: `[[...]]`/`![[...]]` are replaced with private-use-area
 * placeholder tokens BEFORE handing the body to BlockNote (so the parser never
 * sees bracket syntax it might mis-tokenize), then spliced back into the
 * parsed block tree afterward, once every note has a real id to link to
 * (`preprocessNote` + `resolveNote` — the two ends of the pipeline's two-pass
 * design). Standard Markdown — including `![alt](path)` images — is left
 * completely untouched; BlockNote already converts that natively.
 */
import type { Block, SourceFile } from "@/services";
import { parseFrontmatter } from "./frontmatter";
import type {
  PendingRef,
  PreprocessedNote,
  ResolvedNote,
  ResolveResult,
  ScanClassification,
  SourceAdapter,
} from "./types";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "mkv", "avi"]);

function extOf(relPath: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(relPath);
  return m ? m[1].toLowerCase() : "";
}

function classify(file: SourceFile): ScanClassification {
  const lower = file.rel_path.toLowerCase();
  // Excalidraw notes are technically .md files (JSON-in-Markdown) — not real
  // prose, so they're skipped like canvases rather than imported as garbled text.
  if (lower.endsWith(".excalidraw.md") || lower.endsWith(".excalidraw")) {
    return { kind: "skip", reason: "Excalidraw drawing (binary format, not renderable)" };
  }
  const ext = extOf(file.rel_path);
  if (ext === "canvas") {
    return { kind: "skip", reason: "Obsidian canvas (not renderable)" };
  }
  if (ext === "md" || ext === "markdown") {
    return { kind: "note" };
  }
  // Everything else is copied as SOME attachment kind — "never lose content"
  // outranks a tidy extension allow-list; an unrecognized type just lands in
  // the generic file library instead of a specialized one.
  if (IMAGE_EXTS.has(ext)) return { kind: "attachment", attachmentKind: "image" };
  if (VIDEO_EXTS.has(ext)) return { kind: "attachment", attachmentKind: "video" };
  return { kind: "attachment", attachmentKind: "file" };
}

// Private-use-area sentinels: guaranteed no Markdown significance, so they
// always survive BlockNote's parser as an untouched, atomic run of text.
const TOKEN_START = "";
const TOKEN_END = "";
const TOKEN_RE = new RegExp(`${TOKEN_START}L(\\d+)${TOKEN_END}`, "g");

// `(!)?` embed marker, target up to `]`/`|`/`#`, optional `#heading` (dropped
// per v1 scope), optional `|alias`.
const WIKILINK_RE = /(!)?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;

function placeholderWikilinks(body: string): { text: string; pending: PendingRef[] } {
  const pending: PendingRef[] = [];
  let index = 0;
  const text = body.replace(WIKILINK_RE, (raw, embedMark: string | undefined, target: string, alias?: string) => {
    const token = `${TOKEN_START}L${index}${TOKEN_END}`;
    pending.push({
      token,
      isEmbed: !!embedMark,
      targetKey: target.trim().toLowerCase(),
      alias: alias?.trim(),
      raw,
    });
    index++;
    return token;
  });
  return { text, pending };
}

function preprocessNote(relPath: string, rawText: string): PreprocessedNote {
  const { frontmatter, body } = parseFrontmatter(rawText);
  const { text, pending } = placeholderWikilinks(body);

  const slash = relPath.lastIndexOf("/");
  const folder = slash === -1 ? "" : relPath.slice(0, slash);
  const baseName = (slash === -1 ? relPath : relPath.slice(slash + 1)).replace(/\.(md|markdown)$/i, "");
  const title = frontmatter.title || baseName;

  // --- Future seam: Obsidian's Kanban plugin -----------------------------
  // A board is just a note carrying `kanban-plugin: basic` in its
  // frontmatter, with columns as headings and cards as list items — which
  // already import correctly as plain headings/checklists via the normal
  // pipeline below. A later version could detect this flag and emit a real
  // Kanban board block instead; for v1 we only flag it for the report.
  const kanbanPlugin = typeof frontmatter.raw["kanban-plugin"] === "string";
  // ------------------------------------------------------------------------

  return {
    title,
    tags: frontmatter.tags,
    folder,
    body: text,
    pending,
    flags: kanbanPlugin ? { kanbanPlugin: true } : undefined,
  };
}

/** A BlockNote inline-content-ish item; kept loose (`content`/`props` are
 *  opaque JSON end to end — Rust's `document` module note) rather than
 *  fighting BlockNote's generic types for a one-off resolver. */
type InlineItem = Record<string, unknown> & { type: string };

function resolveNote(
  blocks: Block[],
  pending: PendingRef[],
  noteIdMap: Map<string, ResolvedNote>,
  attachmentMap: Map<string, string>,
): ResolveResult {
  const byToken = new Map(pending.map((p) => [p.token, p]));
  let unresolvedLinks = 0;
  let unresolvedAttachments = 0;

  const plainText = (text: string): InlineItem => ({ type: "text", text, styles: {} });

  /** What a single placeholder token resolves to, INLINE (a link/plain text
   *  — never an image; that's handled separately at the block level for the
   *  common "embed alone on its own line" case). */
  function resolveTokenInline(token: string): InlineItem[] {
    const ref = byToken.get(token);
    if (!ref) return [plainText(token)]; // unreachable in practice

    const note = noteIdMap.get(ref.targetKey);
    if (note) {
      return [{ type: "noteLink", props: { noteId: note.id, label: note.title, display: ref.alias ?? "" } }];
    }
    if (ref.isEmbed) {
      // Resolves as an attachment but isn't alone in its block (the common
      // solo-embed case is short-circuited in resolveBlock before this ever
      // runs) — can't represent an inline image, so keep the reference
      // legible as text rather than silently dropping it.
      unresolvedAttachments++;
    } else {
      unresolvedLinks++;
    }
    return [plainText(ref.raw)];
  }

  function splitText(text: string, styles: unknown): InlineItem[] {
    const parts: InlineItem[] = [];
    let lastIndex = 0;
    TOKEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN_RE.exec(text))) {
      if (m.index > lastIndex) parts.push({ type: "text", text: text.slice(lastIndex, m.index), styles });
      parts.push(...resolveTokenInline(m[0]));
      lastIndex = m.index + m[0].length;
    }
    if (lastIndex < text.length) parts.push({ type: "text", text: text.slice(lastIndex), styles });
    return parts.length > 0 ? parts : [{ type: "text", text, styles }];
  }

  function resolveInlineArray(items: unknown[]): unknown[] {
    const out: unknown[] = [];
    for (const raw of items) {
      const item = raw as InlineItem;
      if (item?.type === "text" && typeof item.text === "string" && item.text.includes(TOKEN_START)) {
        out.push(...splitText(item.text, item.styles ?? {}));
      } else if (item?.type === "link" && Array.isArray(item.content)) {
        out.push({ ...item, content: resolveInlineArray(item.content) });
      } else {
        out.push(item);
      }
    }
    return out;
  }

  /** Find the FIRST embed token in `content` that resolves to a copied
   *  attachment — wherever it sits, alone on its own line (the common case)
   *  or mixed inline with other text (e.g. "Here's a diagram: ![[d.png]]") —
   *  and split the content array around it. BlockNote images are block-level,
   *  never inline, so an attachment embed can only be represented by turning
   *  its surroundings into separate blocks. */
  function trySplitImageEmbed(
    content: unknown[],
  ): { before: unknown[]; image: { url: string; name: string }; after: unknown[] } | null {
    for (let i = 0; i < content.length; i++) {
      const item = content[i] as InlineItem;
      if (item?.type !== "text" || typeof item.text !== "string") continue;
      TOKEN_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TOKEN_RE.exec(item.text))) {
        const ref = byToken.get(m[0]);
        if (!ref?.isEmbed) continue;
        const attachmentPath = attachmentMap.get(ref.targetKey);
        if (!attachmentPath) continue;

        const beforeText = item.text.slice(0, m.index);
        const afterText = item.text.slice(m.index + m[0].length);
        const before = [...content.slice(0, i)];
        if (beforeText) before.push({ type: "text", text: beforeText, styles: item.styles });
        const after: unknown[] = [];
        if (afterText) after.push({ type: "text", text: afterText, styles: item.styles });
        after.push(...content.slice(i + 1));

        return {
          before,
          image: { url: attachmentPath, name: ref.targetKey.split("/").pop() ?? ref.targetKey },
          after,
        };
      }
    }
    return null;
  }

  function resolveContentValue(content: unknown): unknown {
    if (Array.isArray(content)) return resolveInlineArray(content);
    if (content && typeof content === "object" && (content as { type?: string }).type === "tableContent") {
      const table = content as { type: string; rows: { cells: unknown[] }[] };
      return {
        ...table,
        rows: table.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) =>
            Array.isArray(cell)
              ? resolveInlineArray(cell)
              : cell && typeof cell === "object" && Array.isArray((cell as { content?: unknown }).content)
                ? { ...(cell as object), content: resolveInlineArray((cell as { content: unknown[] }).content) }
                : cell,
          ),
        })),
      };
    }
    return content;
  }

  /** Resolve one block, possibly into SEVERAL — an inline image embed splits
   *  its surrounding text into separate blocks around a real `image` block. */
  function resolveBlock(block: Block): Block[] {
    if (Array.isArray(block.content)) {
      const split = trySplitImageEmbed(block.content);
      if (split) {
        const out: Block[] = [];
        if (split.before.length > 0) {
          out.push({ ...block, content: resolveInlineArray(split.before) as Block["content"], children: [] });
        }
        out.push({
          id: out.length === 0 ? block.id : crypto.randomUUID(),
          type: "image",
          props: split.image,
          content: undefined,
          children: [],
        });
        if (split.after.length > 0) {
          // Recurse: the remainder may hold further embeds/links of its own.
          out.push(...resolveBlock({ ...block, id: crypto.randomUUID(), content: split.after as Block["content"], children: [] }));
        }
        // The original block's own children (e.g. a list item's nested
        // sub-items) belong with whichever resulting block still carries
        // real content — never the image block itself.
        if (Array.isArray(block.children) && block.children.length > 0) {
          const host = out.find((b) => b.type !== "image") ?? out[out.length - 1];
          host.children = block.children.flatMap(resolveBlock);
        }
        return out;
      }
    }

    const content = resolveContentValue(block.content);
    const children = Array.isArray(block.children) ? block.children.flatMap(resolveBlock) : block.children;
    return [{ ...block, content: content as Block["content"], children }];
  }

  const resolvedBlocks = blocks.flatMap(resolveBlock);
  return { blocks: resolvedBlocks, unresolvedLinks, unresolvedAttachments };
}

export const obsidianAdapter: SourceAdapter = {
  id: "obsidian",
  label: "Obsidian",
  classify,
  preprocessNote,
  resolveNote,
};
