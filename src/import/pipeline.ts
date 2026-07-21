/**
 * Generic import pipeline (step 1 of the multi-app import feature — Obsidian
 * now, Notion/AnyType later plug into the SAME pipeline via `SourceAdapter`,
 * see `types.ts`). This is the ONLY module that touches `services` or
 * BlockNote; an adapter only classifies files and converts text — it never
 * reads/writes anything itself.
 *
 * Division of labor:
 * - Rust (`services.sourceImport`) does filesystem work: enumerate the source
 *   folder, read a note's raw text, copy an attachment by content. It never
 *   parses Markdown (locked rule — that's BlockNote's job below).
 * - The adapter classifies each file (note/attachment/skip) and converts one
 *   note's raw text into a placeholder-laden Markdown body (frontmatter
 *   stripped, wikilink-shaped syntax replaced with tokens it can resolve later).
 * - This pipeline runs BlockNote's own Markdown→blocks parser (never Rust) on
 *   that body, then two-passes the whole import: pass 1 creates every note so
 *   each has a real id; pass 2 asks the adapter to resolve every note's
 *   placeholders against the resulting id map + the attachment path map, then
 *   saves the final blocks.
 *
 * Import always targets a NEW vault the caller already opened (the multi-vault
 * flow's `switchVault`) — this module never touches "the previously open
 * vault" in any way; it only calls `services.notes`/`services.tags` against
 * whatever vault is current when it runs.
 */
import { BlockNoteEditor } from "@blocknote/core";

import { notes, sourceImport, tags } from "@/services";
import type { AttachmentKind, Block } from "@/services";
import { editorSchema } from "@/editor/schema";
import type { ImportProgress, ImportReport, ResolvedNote, SourceAdapter } from "./types";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function joinPath(root: string, relPath: string): string {
  return `${root.replace(/[\\/]+$/, "")}/${relPath}`;
}

function basename(relPath: string): string {
  const i = relPath.lastIndexOf("/");
  return i === -1 ? relPath : relPath.slice(i + 1);
}

function stripExt(relPath: string): string {
  return relPath.replace(/\.[^./]+$/, "");
}

/** One note as it stands between pass 1 (created, parsed, not yet resolved)
 *  and pass 2 (resolved + saved). */
interface CreatedNote {
  relPath: string;
  title: string;
  id: string;
  blocks: Block[];
  pending: import("./types").PendingRef[];
  flags?: { kanbanPlugin?: boolean };
}

/**
 * Import every note (and attachment) under `sourcePath` into the CURRENTLY
 * OPEN vault, using `adapter` to interpret the source format. Callers open
 * the destination vault first (via the multi-vault switcher) — this function
 * has no vault-selection concerns of its own.
 */
export async function runImport(
  sourcePath: string,
  adapter: SourceAdapter,
  onProgress: (p: ImportProgress) => void,
): Promise<ImportReport> {
  const report: ImportReport = {
    notesImported: 0,
    attachmentsCopied: 0,
    unresolvedLinks: 0,
    unresolvedAttachments: 0,
    skippedFiles: [],
    pluginNotes: [],
    errors: [],
  };

  onProgress({ phase: "scanning" });
  const files = await sourceImport.scanFolder(sourcePath);

  const noteFiles: string[] = [];
  const attachmentFiles: { relPath: string; kind: AttachmentKind }[] = [];
  for (const f of files) {
    const c = adapter.classify(f);
    if (c.kind === "note") noteFiles.push(f.rel_path);
    else if (c.kind === "attachment") attachmentFiles.push({ relPath: f.rel_path, kind: c.attachmentKind });
    else report.skippedFiles.push({ relPath: f.rel_path, reason: c.reason });
  }

  // --- Copy attachments, building the lookup map (by bare filename AND full
  // source-relative path, both lowercased — matches how wikilink/embed
  // targets are looked up in obsidianAdapter.ts). ---------------------------
  const attachmentMap = new Map<string, string>();
  for (let i = 0; i < attachmentFiles.length; i++) {
    const { relPath, kind } = attachmentFiles[i];
    onProgress({ phase: "copying-attachments", done: i, total: attachmentFiles.length });
    try {
      const vaultRelPath = await sourceImport.copyAttachment(kind, joinPath(sourcePath, relPath));
      attachmentMap.set(relPath.toLowerCase(), vaultRelPath);
      attachmentMap.set(basename(relPath).toLowerCase(), vaultRelPath);
      report.attachmentsCopied++;
    } catch (e) {
      report.errors.push({ relPath, message: errorMessage(e) });
    }
  }

  // One headless BlockNote instance, same schema as the real editor (custom
  // `noteLink` inline content included) — never mounted to a DOM node, used
  // purely for its Markdown→blocks parser.
  const editor = BlockNoteEditor.create({ schema: editorSchema });

  // --- Pass 1: create every note, building the id map. ---------------------
  const noteIdMap = new Map<string, ResolvedNote>();
  const created: CreatedNote[] = [];
  for (let i = 0; i < noteFiles.length; i++) {
    const relPath = noteFiles[i];
    onProgress({ phase: "creating-notes", done: i, total: noteFiles.length });
    try {
      const rawText = await sourceImport.readTextFile(joinPath(sourcePath, relPath));
      const pre = adapter.preprocessNote(relPath, rawText);
      const blocks = editor.tryParseMarkdownToBlocks(pre.body) as unknown as Block[];
      const note = await notes.createIn(pre.title, pre.folder);
      if (pre.tags.length > 0) await tags.set(note.id, pre.tags);

      const resolved: ResolvedNote = { id: note.id, title: pre.title };
      noteIdMap.set(stripExt(relPath).toLowerCase(), resolved);
      noteIdMap.set(stripExt(basename(relPath)).toLowerCase(), resolved);

      created.push({ relPath, title: pre.title, id: note.id, blocks, pending: pre.pending, flags: pre.flags });
      if (pre.flags?.kanbanPlugin) report.pluginNotes.push(pre.title);
    } catch (e) {
      report.errors.push({ relPath, message: errorMessage(e) });
    }
  }

  // --- Pass 2: resolve placeholders against the now-complete id map, save. -
  for (let i = 0; i < created.length; i++) {
    const rec = created[i];
    onProgress({ phase: "resolving-links", done: i, total: created.length });
    try {
      const { blocks, unresolvedLinks, unresolvedAttachments } = adapter.resolveNote(
        rec.blocks,
        rec.pending,
        noteIdMap,
        attachmentMap,
      );
      report.unresolvedLinks += unresolvedLinks;
      report.unresolvedAttachments += unresolvedAttachments;

      const note = await notes.read(rec.id);
      await notes.save({ ...note, blocks });
      report.notesImported++;
    } catch (e) {
      report.errors.push({ relPath: rec.relPath, message: errorMessage(e) });
    }
  }

  onProgress({ phase: "done" });
  return report;
}
