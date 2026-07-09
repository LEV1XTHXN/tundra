/**
 * Quick-note scratchpad (Phase 2 step 5). A SINGLE always-there capture space
 * for ideas — not one of the vault's notes. It uses a trimmed editor
 * (`quickNoteSchema`: basic text, lists, attachments; no links/headings/tables)
 * and autosaves to its own file via `services.quickNote`. No title, icon,
 * backlinks, or inspector — the point is to write fast and organize later.
 *
 * React renders only; all IO goes through `services` (never `@tauri-apps/api`).
 */
import { useEffect, useRef, useState } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";

import { attachments, quickNote } from "@/services";
import type { AttachmentKind, Note } from "@/services";
import { toInitialContent } from "@/editor/blockContent";
import { createDebouncedFlush, type DebouncedFlush } from "@/editor/debouncedFlush";
import { quickNoteSchema } from "./quickNoteSchema";

const DEBOUNCE_MS = 600;
const MAX_WAIT_MS = 2500;

/** Map a browser File's MIME type onto an attachment library (CLAUDE.md §5.2). */
function attachmentKindFromMime(mime: string): AttachmentKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

export function QuickNoteView({
  vaultPath,
  onError,
}: {
  vaultPath: string;
  onError: (message: string) => void;
}) {
  const [note, setNote] = useState<Note | null>(null);

  useEffect(() => {
    let cancelled = false;
    quickNote
      .read()
      .then((n) => {
        if (!cancelled) setNote(n);
      })
      .catch((e) => {
        if (!cancelled) onError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  if (!note) return <div className="centered muted">Loading…</div>;
  return <LoadedQuickNote note={note} vaultPath={vaultPath} onError={onError} />;
}

function LoadedQuickNote({
  note,
  vaultPath,
  onError,
}: {
  note: Note;
  vaultPath: string;
  onError: (message: string) => void;
}) {
  const editor = useCreateBlockNote({
    schema: quickNoteSchema,
    initialContent: toInitialContent(note.blocks) as never,
    // Attachments still route through Rust's content-addressed store (same as
    // the main editor) — quick notes can hold images/videos/files.
    uploadFile: async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return attachments.import(attachmentKindFromMime(file.type), file.name, bytes);
    },
    resolveFileUrl: async (url: string) =>
      url.startsWith("attachments/") ? attachments.resolveUrl(vaultPath, url) : url,
  });

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  // Preserves the scratchpad's id/created across saves.
  const noteRef = useRef(note);

  const flush = async () => {
    setSaveState("saving");
    try {
      const updated: Note = {
        ...noteRef.current,
        blocks: editor.document as unknown as Note["blocks"],
      };
      await quickNote.save(updated);
      noteRef.current = updated;
      setSaveState("saved");
    } catch (e) {
      onError(String(e));
    }
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const debouncedRef = useRef<DebouncedFlush | null>(null);
  if (debouncedRef.current === null) {
    debouncedRef.current = createDebouncedFlush(() => void flushRef.current(), {
      debounceMs: DEBOUNCE_MS,
      maxWaitMs: MAX_WAIT_MS,
    });
  }

  // Flush any pending edit on unmount (e.g. switching away from the view) so a
  // debounce window is never silently lost.
  useEffect(() => {
    const debounced = debouncedRef.current!;
    return () => {
      if (debounced.isPending()) {
        debounced.cancel();
        void flushRef.current();
      }
    };
  }, []);

  return (
    <>
    <div className="editor-pane quicknote">
      <div className="quicknote-header">
        <h1 className="quicknote-title">Quick notes</h1>
        <p className="quicknote-hint muted">
          A scratchpad for fast capture — jot ideas here, then move them into notes.
        </p>
      </div>
      <BlockNoteView
        editor={editor}
        onChange={() => {
          setSaveState("saving");
          debouncedRef.current!.schedule();
        }}
        theme="light"
      />
      <div className="editor-tail-space" aria-hidden="true" />
    </div>
    {/* Anchored to the non-scrolling .main-pane — pinned to its bottom-left
        corner, matching NoteEditor (see .status). */}
    <div className="status" aria-live="polite">
      {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
    </div>
    </>
  );
}
