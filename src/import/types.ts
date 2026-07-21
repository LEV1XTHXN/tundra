/**
 * Shared types for the import pipeline (`pipeline.ts`) and every source
 * adapter (`obsidianAdapter.ts` today; Notion/AnyType later). The pipeline is
 * the ONLY thing that talks to `services` and BlockNote; an adapter only ever
 * classifies files and converts text — see `pipeline.ts`'s doc comment for the
 * full division of labor.
 */
import type { AttachmentKind, Block, SourceFile } from "@/services";

/** How the pipeline should treat one scanned source file. */
export type ScanClassification =
  | { kind: "note" }
  | { kind: "attachment"; attachmentKind: AttachmentKind }
  | { kind: "skip"; reason: string };

/** One `[[wikilink]]`-shaped reference an adapter placeholdered out of a
 *  note's body before handing it to BlockNote's Markdown parser (BlockNote
 *  doesn't understand wikilink syntax) — resolved back in afterward, once
 *  every note has an id (`pipeline.ts`'s two-pass design). Adapter-owned
 *  shape; the pipeline only threads it through unread. */
export interface PendingRef {
  /** The exact placeholder text substituted into the Markdown body — must be
   *  a string BlockNote's parser will pass through unchanged (no Markdown-
   *  significant characters). */
  token: string;
  /** Whether this came from an embed (`![[…]]`) vs. a plain link (`[[…]]`). */
  isEmbed: boolean;
  /** The link target, exactly as the adapter needs to look it up (already
   *  stripped of alias/heading — adapter-defined key shape). */
  targetKey: string;
  /** A custom display word (e.g. `[[Note|alias]]`'s "alias"), if the source
   *  syntax supports one — shown instead of the resolved title. */
  alias?: string;
  /** The unmodified original text (e.g. `[[Note#Heading|alias]]`) — restored
   *  verbatim if `targetKey` never resolves, so nothing is silently dropped. */
  raw: string;
}

/** A resolved note-link target, keyed by the adapter's own lookup scheme. */
export interface ResolvedNote {
  id: string;
  title: string;
}

/** Per-note result of resolving its `PendingRef`s against the pass-1 id map
 *  and the attachment path map — feeds straight into the report's counters. */
export interface ResolveResult {
  blocks: Block[];
  unresolvedLinks: number;
  unresolvedAttachments: number;
}

/** A note ready to be created: already frontmatter-stripped and
 *  wikilink-placeholdered, but not yet Markdown→blocks converted (the
 *  pipeline owns the one shared BlockNote instance). */
export interface PreprocessedNote {
  title: string;
  tags: string[];
  /** Vault-relative destination folder (nested path preserved), `""` for root. */
  folder: string;
  /** Markdown body: frontmatter removed, `[[wikilinks]]`/`![[embeds]]`
   *  replaced with `PendingRef` tokens. Standard Markdown (including
   *  `![alt](path)` images) is left untouched — BlockNote parses that natively. */
  body: string;
  pending: PendingRef[];
  /** Adapter-specific report flags — e.g. Obsidian's Kanban-plugin seam. */
  flags?: { kanbanPlugin?: boolean };
}

/**
 * A source app's plug-in point. The pipeline owns ALL filesystem/service/
 * BlockNote calls; an adapter only classifies files and converts text —
 * see each method's doc for exactly where the line falls.
 */
export interface SourceAdapter {
  id: string;
  label: string;
  /** Classify one scanned file — note / attachment (+ which library) / skip
   *  (+ a human reason for the report). Extension/filename rules only; never
   *  reads file content (the pipeline does that for notes, once). */
  classify(file: SourceFile): ScanClassification;
  /** Strip frontmatter (pulling out title/tags/adapter-specific flags) and
   *  placeholder out wikilink-shaped syntax. `relPath` is this file's path in
   *  the SOURCE tree (used to derive the destination folder + fallback title). */
  preprocessNote(relPath: string, rawText: string): PreprocessedNote;
  /** Turn a note's placeholder-laden, freshly-parsed blocks into final blocks:
   *  resolved links become `noteLink` inline nodes, resolved image embeds
   *  become `image` blocks, and anything that never resolves is restored as
   *  plain text (never dropped) — see `obsidianAdapter.ts` for the algorithm. */
  resolveNote(
    blocks: Block[],
    pending: PendingRef[],
    noteIdMap: Map<string, ResolvedNote>,
    attachmentMap: Map<string, string>,
  ): ResolveResult;
}

/** Final tally shown to the user after an import — "so the user knows
 *  exactly what to review by hand" (nothing here is ever silent). */
export interface ImportReport {
  notesImported: number;
  attachmentsCopied: number;
  unresolvedLinks: number;
  unresolvedAttachments: number;
  skippedFiles: { relPath: string; reason: string }[];
  /** Notes carrying an adapter-flagged plugin format (e.g. Obsidian's Kanban
   *  plugin) that were imported as plain content, not the plugin's real view. */
  pluginNotes: string[];
  errors: { relPath: string; message: string }[];
}

export type ImportProgress =
  | { phase: "scanning" }
  | { phase: "copying-attachments"; done: number; total: number }
  | { phase: "creating-notes"; done: number; total: number }
  | { phase: "resolving-links"; done: number; total: number }
  | { phase: "done" };
