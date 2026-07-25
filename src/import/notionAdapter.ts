/**
 * Notion source adapter ("Markdown & CSV" export — step 2 of the multi-app
 * import feature; see `pipeline.ts`'s doc comment for the generic/adapter
 * split, and `obsidianAdapter.ts` for the sibling implementation). Reuses the
 * shared pipeline completely unchanged in spirit — only small, mechanical
 * additions landed there: a `sourceRelPath` param on `resolveNote` (Notion's
 * links are relative to the LINKING file, not the vault root); an optional
 * `adapter.prepare(files)` lifecycle hook (this adapter needs the whole
 * export's shape up front to know which pages have children — see below);
 * generalizing Obsidian's `flags.kanbanPlugin` into an adapter-neutral
 * `flags.note` string; and `isContainerIndex`/`report.pagesBecameFolders` for
 * the hierarchy mapping this file owns.
 *
 * Verified against a REAL "Include subpages" export (not just documentation
 * or a third-party tool's fixtures — those got the folder-naming detail
 * wrong; see below):
 *   - Every exported page/database FILE is named `<Title> <32-hex-id>` (a
 *     single space before the id — `\s([0-9a-fA-F]{32})`), with the id (and
 *     any suffix like a database CSV's `_all`) discarded for the clean title.
 *   - A page with children gets a sibling FOLDER — but named the CLEAN TITLE
 *     ONLY, with NO id (confirmed on a real export: `Projects <id>.md` sits
 *     beside a folder literally named `Projects`, not `Projects <id>`).
 *     `notion2obsidian`'s reference fixtures suggested the folder ALSO
 *     carried the id — that turned out to be wrong for real Notion output,
 *     exactly the kind of assumption worth verifying against real data
 *     instead of documentation. `hasChildren()` matches on the stripped title.
 *   - Internal links are ordinary Markdown links (`[text](path)`) — NOT a
 *     custom bracket syntax like Obsidian's — whose relative path's basename
 *     carries the target's id; BlockNote parses these natively into its own
 *     `link` inline content, so (unlike Obsidian) this adapter needs no
 *     placeholder/token pass at all. `resolveNote` just walks the
 *     already-parsed tree and rewrites `link`/`image` nodes whose target is
 *     recognizably internal.
 *   - A database exports as `<Name> <id>.csv` (table-view columns only) plus
 *     a folder of its row pages — structurally the exact same
 *     "<Name> <id>.<ext>" + sibling "<Name>/" pattern as a page with
 *     children, so it gets the identical container treatment below.
 *
 * Hierarchy mapping: Notion has no folders separate from pages — a page (or
 * database) WITH children is both content and a container. Rather than a
 * note+folder pair sharing one name (confusing, and only one could hold real
 * content), `prepare()` scans the whole file list once to learn which paths
 * are containers (have a same-named sibling folder), and `preprocessNote`
 * places a container's own note ONE level INSIDE a folder named after it —
 * its children, whose own parent-path segment is that same title, land right
 * alongside it. A link to a container page still resolves to that one note
 * (the pass-1 id map is keyed by source path identity, independent of which
 * folder the note ends up in) — i.e. to its index note, never a folder.
 */
import type { Block, SourceFile } from "@/services";
import { csvToMarkdownTable, parseCsv } from "./csv";
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

/** A single space, then exactly 32 hex chars, not immediately followed by
 *  another hex digit (so a longer coincidental hex run doesn't partially
 *  match) — matches right after the clean title in any Notion-exported name.
 *  Deliberately NOT `\b`: a database CSV's `_all` suffix follows the id with
 *  no boundary (`f` and `_` are both word characters), so `\b` misses it. */
const NOTION_ID_RE = /\s([0-9a-fA-F]{32})(?![0-9a-fA-F])/;

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

/** Strip a Notion id (and anything after it — extension, `_all`, …) off a
 *  file or folder name, giving the clean title Notion originally showed. */
function stripNotionId(name: string): string {
  const m = NOTION_ID_RE.exec(name);
  return (m ? name.slice(0, m.index) : name).trim();
}

/**
 * Every directory path that exists anywhere in the scanned export (every
 * prefix of every file's `dirnameOf`, not just immediate parents), lowercased
 * — populated once by `prepare()` before any note is processed. Notion has no
 * folders: a page/database is "a container" exactly when its OWN path (minus
 * extension) appears in this set, i.e. some other file lives inside a
 * same-named sibling directory.
 */
let containerDirs = new Set<string>();

function prepare(files: SourceFile[]): void {
  containerDirs = new Set();
  for (const f of files) {
    const parts = dirnameOf(f.rel_path).split("/").filter(Boolean);
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      containerDirs.add(acc.toLowerCase());
    }
  }
}

/** Does `relPath` (a page or database file) have a sibling folder of
 *  children — i.e. is it BOTH content and a container? Verified against a
 *  real export: the sibling folder is named the CLEAN title only (never the
 *  id) — `Projects <id>.md` sits beside a folder literally named `Projects`,
 *  not `Projects <id>` — so the match must strip the id before looking. */
function hasChildren(relPath: string): boolean {
  const dir = dirnameOf(relPath);
  const title = stripNotionId(basename(relPath));
  const candidate = dir ? `${dir}/${title}` : title;
  return containerDirs.has(candidate.toLowerCase());
}

function classify(file: SourceFile): ScanClassification {
  const ext = extOf(file.rel_path);
  if (ext === "md" || ext === "csv") return { kind: "note" };
  // Everything else is some attachment (never lose content over an extension
  // allow-list) — same philosophy as the Obsidian adapter.
  if (IMAGE_EXTS.has(ext)) return { kind: "attachment", attachmentKind: "image" };
  if (VIDEO_EXTS.has(ext)) return { kind: "attachment", attachmentKind: "video" };
  return { kind: "attachment", attachmentKind: "file" };
}

/** Resolve `ref` (already URL-decoded, anchor stripped) against the
 *  directory of the file that referenced it — Notion's links/images are
 *  relative to the LINKING page, not the export root. */
function resolveRelative(baseDir: string, ref: string): string {
  const stack = baseDir ? baseDir.split("/") : [];
  for (const part of ref.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

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

/** The lookup key for an internal link's target, matching exactly how
 *  `pipeline.ts` registers `noteIdMap` (`stripExt(basename(relPath)).toLowerCase()`)
 *  — or `null` if `href` isn't a recognizable internal Notion link. */
function internalLinkKey(href: string): string | null {
  if (isAbsoluteUrl(href)) return null;
  const withoutAnchor = decodeHref(href).split("#")[0];
  const base = basename(withoutAnchor);
  if (!NOTION_ID_RE.test(base)) return null;
  return base.replace(/\.[^./]+$/, "").toLowerCase();
}

/** Candidate `attachmentMap` keys for a (possibly relative) image/file href,
 *  matching `pipeline.ts`'s registration (full source-relative path AND bare
 *  filename, both lowercased, extension kept). `null` for absolute URLs —
 *  Notion's temporary signed file URLs are left as-is, never looked up. */
function attachmentLookupKeys(href: string, baseDir: string): string[] | null {
  if (isAbsoluteUrl(href)) return null;
  const decoded = decodeHref(href.split("#")[0]);
  const resolved = resolveRelative(baseDir, decoded);
  return [resolved.toLowerCase(), basename(resolved).toLowerCase()];
}

/** An absolute-URL image embed in the RAW export text — Notion leaves these
 *  for files it couldn't (or the export option didn't) localize; matched
 *  before Markdown parsing since it only needs a yes/no signal for the report. */
const EXTERNAL_IMAGE_RE = /!\[[^\]]*]\((https?:\/\/[^)]+)\)/;

function preprocessNote(relPath: string, rawText: string): PreprocessedNote {
  // Where this file's PARENT lives in Tundra — every ancestor segment is
  // itself a container (that's what made it a directory in the export), so
  // stripping each one's id reproduces the clean folder path directly.
  const parentFolder = dirnameOf(relPath).split("/").filter(Boolean).map(stripNotionId).join("/");
  // Notion has no folders distinct from pages: a page/database WITH children
  // is both content and a container. Rather than a note+folder pair sharing
  // one name (confusing, and only one can hold the real content), the note
  // becomes the INDEX note one level INSIDE a folder named after it — its
  // children (already destined for exactly that folder, since their own
  // parent-path segment is this same title) land right alongside it.
  const isContainer = hasChildren(relPath);

  if (extOf(relPath) === "csv") {
    const title = stripNotionId(basename(relPath)) || basename(relPath);
    const folder = isContainer ? (parentFolder ? `${parentFolder}/${title}` : title) : parentFolder;
    const rows = parseCsv(rawText);
    const body =
      `This note is a flattened view of the Notion database **${title}** — only its ` +
      `table-view columns came through the export; filters, sorts, and any rollup/formula ` +
      `values are not included.\n\n${csvToMarkdownTable(rows)}`;
    return {
      title,
      tags: [],
      folder,
      body,
      pending: [],
      flags: { note: "Notion database (filters/sorts/rollups/formulas are not in the export; row pages imported separately)" },
      isContainerIndex: isContainer,
    };
  }

  const title = stripNotionId(basename(relPath)) || basename(relPath).replace(/\.md$/i, "");
  const folder = isContainer ? (parentFolder ? `${parentFolder}/${title}` : title) : parentFolder;
  const hasExternalFileLink = EXTERNAL_IMAGE_RE.test(rawText);
  return {
    title,
    tags: [],
    folder,
    body: rawText,
    pending: [],
    flags: hasExternalFileLink
      ? { note: "Contains a Notion-hosted file link (signed URL, may expire) — kept as an external link, not copied locally" }
      : undefined,
    isContainerIndex: isContainer,
  };
}

type InlineItem = Record<string, unknown> & { type: string };

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

  function resolveInlineArray(items: unknown[]): unknown[] {
    return items.map((raw) => {
      const item = raw as InlineItem;
      if (item?.type === "link" && typeof item.href === "string") {
        const key = internalLinkKey(item.href);
        if (key) {
          const note = noteIdMap.get(key);
          const text = linkText(item.content) || "Untitled";
          if (note) {
            const display = text !== note.title ? text : "";
            return { type: "noteLink", props: { noteId: note.id, label: note.title, display } };
          }
          unresolvedLinks++;
          return { type: "text", text, styles: {} };
        }
        // A genuinely external link (or an internal one this export doesn't
        // contain the target for) — leave BlockNote's native handling as-is,
        // just keep walking its nested text in case it holds more tokens.
        return Array.isArray(item.content) ? { ...item, content: resolveInlineArray(item.content) } : item;
      }
      return item;
    });
  }

  function resolveBlock(block: Block): Block {
    if (block.type === "image" && block.props && typeof block.props === "object") {
      const props = block.props as { url?: unknown; name?: unknown };
      if (typeof props.url === "string" && !isAbsoluteUrl(props.url)) {
        const keys = attachmentLookupKeys(props.url, baseDir) ?? [];
        const hit = keys.map((k) => attachmentMap.get(k)).find((v): v is string => !!v);
        if (hit) {
          return { ...block, props: { ...props, url: hit }, children: [] };
        }
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
      // Absolute (signed Notion) URL, or no url at all — leave untouched;
      // `preprocessNote` already flagged the note for the report.
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

export const notionAdapter: SourceAdapter = {
  id: "notion",
  label: "Notion",
  prepare,
  classify,
  preprocessNote,
  resolveNote,
};
