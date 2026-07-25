/**
 * Anytype source adapter (Markdown export — step 3 of the multi-app import
 * feature; see `pipeline.ts`'s doc comment for the generic/adapter split, and
 * `obsidianAdapter.ts`/`notionAdapter.ts` for the sibling implementations).
 * Reuses the shared pipeline completely unchanged.
 *
 * Verified against a REAL Anytype Markdown export (a ~130-object TTRPG
 * campaign vault), not assumed — Anytype's own docs/community don't document
 * the on-disk layout, and relation-export-as-frontmatter is reported as
 * inconsistent across versions, so this was the only reliable way to know:
 *   - FLAT by default: every object is `<slug>.md` directly at the export
 *     root — no id in the filename at all (unlike Notion's `<title> <id>`),
 *     and (confirmed by listing the real export's directories) no
 *     subfolders either — Anytype's exporter doesn't reproduce any hierarchy
 *     on disk. `folder = dirnameOf(relPath)` still wins when a hierarchical
 *     export DOES show up (unmodified — there's no id to strip), but since
 *     the real export never exercises that path, the fallback grouping below
 *     is what a user actually sees on import: notes are grouped into a
 *     folder named after their `Object type` relation (Quest/Location/NPC/…)
 *     — the only quasi-hierarchical signal this export actually contains.
 *     The relation itself is left out of the rendered properties list once
 *     it's spent this way, exactly like a tag relation is.
 *   - Attachments live in one shared `files/` folder, referenced by ordinary
 *     `![alt](files/name.ext)` Markdown images.
 *   - Inter-object links are ordinary `[label](target.md)` Markdown links —
 *     BlockNote parses these natively into its own `link` inline content, so
 *     (like Notion, unlike Obsidian) no placeholder/token pass is needed;
 *     `resolveNote` rewrites `link`/`image` nodes in place. Because filenames
 *     carry no id, the lookup key is the plain relative path — closer to
 *     Obsidian's name-based resolution than Notion's id-based one.
 *   - YAML frontmatter holds "relations": e.g. `Object type`, `Creation
 *     date`, `Created by`, `Tag` (singular, list-valued — NOT `tags`), and
 *     Anytype's own `id`. Relation names are freeform human labels WITH
 *     SPACES ("Object type") — this actually broke the shared
 *     `frontmatter.ts` parser (built for Obsidian's single-word keys), which
 *     got fixed as part of this work; see its doc comment. The frontmatter
 *     also opens with a `# yaml-language-server: $schema=…` comment line
 *     (an editor-tooling hint, not a relation) that must never be parsed as one.
 *   - A `schemas/` folder holds one JSON Schema per Anytype "type" (matching
 *     each note's `$schema` hint) — not user content, so it's skipped with
 *     its own report reason rather than lumped in with "out of scope" JSON.
 *   - No "Set"/"Collection" object type appeared in the real export, so
 *     database-like structures aren't specifically handled — anything of
 *     that shape degrades to a plain note per the generic rule.
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

function basename(relPath: string): string {
  const i = relPath.lastIndexOf("/");
  return i === -1 ? relPath : relPath.slice(i + 1);
}

function dirnameOf(relPath: string): string {
  const i = relPath.lastIndexOf("/");
  return i === -1 ? "" : relPath.slice(0, i);
}

function classify(file: SourceFile): ScanClassification {
  const ext = extOf(file.rel_path);
  if (ext === "md") return { kind: "note" };
  if (ext === "json") {
    if (/^schemas\//i.test(file.rel_path)) {
      return { kind: "skip", reason: "Anytype relation schema definition (not user content)" };
    }
    // Anytype's other export format ("Any-Block") is JSON-based and out of
    // scope for v1 — surfaced distinctly rather than silently dropped.
    return { kind: "skip", reason: "Any-Block JSON export (out of scope for v1)" };
  }
  if (IMAGE_EXTS.has(ext)) return { kind: "attachment", attachmentKind: "image" };
  if (VIDEO_EXTS.has(ext)) return { kind: "attachment", attachmentKind: "video" };
  return { kind: "attachment", attachmentKind: "file" };
}

const H1_RE = /^#\s+(.+?)\s*$/m;

/** Render every frontmatter relation EXCEPT the ones already used for tags
 *  (or, below, folder grouping) as a small Markdown bullet list — fed
 *  straight into BlockNote's own parser (never hand-built as block JSON), so
 *  "never silently drop relation data" costs nothing beyond a few lines of
 *  text at the top of the note. */
function renderProperties(raw: Record<string, string | string[]>, excludeKeys: Set<string>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (excludeKeys.has(key)) continue;
    const display = Array.isArray(value) ? value.join(", ") : value;
    if (!display) continue;
    lines.push(`- **${key}:** ${display}`);
  }
  return lines.length > 0 ? `${lines.join("\n")}\n\n---\n\n` : "";
}

function sanitizeFolderName(name: string): string {
  return name.trim().replace(/[\\/]+/g, "-");
}

/** The real export has no real folders at all (see the doc comment above) —
 *  its only quasi-hierarchical signal is the `Object type` relation
 *  (Quest/Location/NPC/…), so that's what groups notes into folders. A
 *  hierarchical export (should one ever show up) still wins via `dirnameOf`
 *  in `preprocessNote` below; this is strictly a fallback for the flat case. */
function objectTypeKey(raw: Record<string, string | string[]>): string | undefined {
  return Object.keys(raw).find((k) => /^object type$/i.test(k));
}

function objectTypeFolder(raw: Record<string, string | string[]>, key: string | undefined): string | undefined {
  if (!key) return undefined;
  const value = raw[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first ? sanitizeFolderName(first) : undefined;
}

function preprocessNote(relPath: string, rawText: string): PreprocessedNote {
  const { frontmatter, body } = parseFrontmatter(rawText);

  const titleKey = Object.keys(frontmatter.raw).find((k) => /^(title|name)$/i.test(k));
  const titleRaw = titleKey ? frontmatter.raw[titleKey] : undefined;
  const fromFrontmatter = typeof titleRaw === "string" ? titleRaw : undefined;
  const fromH1 = H1_RE.exec(body)?.[1]?.trim();
  const title = fromFrontmatter || fromH1 || basename(relPath).replace(/\.md$/i, "");

  const tagKeys = new Set(Object.keys(frontmatter.raw).filter((k) => /^tags?$/i.test(k)));
  const typeKey = objectTypeKey(frontmatter.raw);
  const excludeKeys = typeKey ? new Set(tagKeys).add(typeKey) : tagKeys;
  const properties = renderProperties(frontmatter.raw, excludeKeys);

  const folder = dirnameOf(relPath) || objectTypeFolder(frontmatter.raw, typeKey) || "";

  return {
    title,
    tags: frontmatter.tags,
    folder,
    body: properties + body,
    pending: [],
  };
}

type InlineItem = Record<string, unknown> & { type: string };

function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function isAbsoluteUrl(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
}

/** Resolve `ref` (already decoded, anchor stripped) against the directory of
 *  the file that referenced it. Anytype's real export is flat (so this is a
 *  no-op there), but a hierarchical export — the task explicitly allows for
 *  one — would make links/images relative to the linking object like Notion's. */
function resolveRelative(baseDir: string, ref: string): string {
  const stack = baseDir ? baseDir.split("/") : [];
  for (const part of ref.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function linkText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content.map((c) => (typeof (c as InlineItem)?.text === "string" ? ((c as InlineItem).text as string) : "")).join("");
}

function resolveNote(
  blocks: Block[],
  _pending: PendingRef[],
  noteIdMap: Map<string, ResolvedNote>,
  attachmentMap: Map<string, string>,
  sourceRelPath: string,
): ResolveResult {
  const baseDir = dirnameOf(sourceRelPath);
  let unresolvedLinks = 0;
  let unresolvedAttachments = 0;

  /** No id to key by (unlike Notion) — try the resolved full path AND the
   *  bare basename, both matching how pipeline.ts registers `noteIdMap`. */
  function noteLookupKeys(href: string): string[] {
    const decoded = decodeHref(href.split("#")[0]);
    const resolved = resolveRelative(baseDir, decoded).replace(/\.md$/i, "");
    return [resolved.toLowerCase(), basename(resolved).toLowerCase()];
  }

  function attachmentLookupKeys(href: string): string[] {
    const decoded = decodeHref(href.split("#")[0]);
    const resolved = resolveRelative(baseDir, decoded);
    return [resolved.toLowerCase(), basename(resolved).toLowerCase()];
  }

  function resolveInlineArray(items: unknown[]): unknown[] {
    return items.map((raw) => {
      const item = raw as InlineItem;
      if (item?.type === "link" && typeof item.href === "string" && !isAbsoluteUrl(item.href)) {
        const decodedPath = decodeHref(item.href.split("#")[0]);
        if (!/\.md$/i.test(decodedPath)) return item; // not a link to another object
        const note = noteLookupKeys(item.href).map((k) => noteIdMap.get(k)).find(Boolean);
        const text = linkText(item.content) || "Untitled";
        if (note) {
          const display = text !== note.title ? text : "";
          return { type: "noteLink", props: { noteId: note.id, label: note.title, display } };
        }
        unresolvedLinks++;
        return { type: "text", text, styles: {} };
      }
      if (item?.type === "link" && Array.isArray(item.content)) {
        return { ...item, content: resolveInlineArray(item.content) };
      }
      return item;
    });
  }

  function resolveBlock(block: Block): Block {
    if (block.type === "image" && block.props && typeof block.props === "object") {
      const props = block.props as { url?: unknown; name?: unknown };
      if (typeof props.url === "string" && !isAbsoluteUrl(props.url)) {
        const keys = attachmentLookupKeys(props.url);
        const hit = keys.map((k) => attachmentMap.get(k)).find((v): v is string => !!v);
        if (hit) return { ...block, props: { ...props, url: hit }, children: [] };
        unresolvedAttachments++;
        const name = typeof props.name === "string" ? props.name : "image";
        return {
          ...block,
          type: "paragraph",
          props: undefined,
          content: [{ type: "text", text: `[Missing attachment: ${name}]`, styles: {} }],
          children: [],
        };
      }
      return block;
    }

    let content: unknown = block.content;
    if (Array.isArray(content)) {
      content = resolveInlineArray(content);
    } else if (content && typeof content === "object" && (content as { type?: string }).type === "tableContent") {
      const table = content as { type: string; rows: { cells: unknown[] }[] };
      content = {
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

    const children = Array.isArray(block.children) ? block.children.map(resolveBlock) : block.children;
    return { ...block, content: content as Block["content"], children };
  }

  const resolvedBlocks = blocks.map(resolveBlock);
  return { blocks: resolvedBlocks, unresolvedLinks, unresolvedAttachments };
}

export const anytypeAdapter: SourceAdapter = {
  id: "anytype",
  label: "Anytype",
  classify,
  preprocessNote,
  resolveNote,
};
