/**
 * Phase 1 step 4: the real BlockNote editor, replacing the Phase 0 textarea
 * skeleton. Step 8 adds external-change reconciliation: clean editor -> file
 * changed externally -> reload silently; dirty editor -> file changed ->
 * banner (keep mine / take theirs), never auto-overwrite; file deleted ->
 * keep the buffer, offer to recreate. React renders only — every read/write
 * goes through the `services` layer; this module never imports
 * `@tauri-apps/api` (checked by `npm run check:layering`).
 */
import { useEffect, useRef, useState } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

import { attachments, notes, watcher } from "@/services";
import type { AttachmentKind, Icon, Note } from "@/services";
import { Input } from "@/components/ui/input";
import { NoteIcon } from "@/nav/NoteIcon";
import { IconPicker } from "@/nav/IconPicker";
import { toInitialContent } from "./blockContent";
import { createDebouncedFlush, type DebouncedFlush } from "./debouncedFlush";
import { decideReconciliation } from "./reconcile";

const DEBOUNCE_MS = 600;
const MAX_WAIT_MS = 2500;

/** Map a browser File's MIME type onto an attachment library (CLAUDE.md §5.2). */
function attachmentKindFromMime(mime: string): AttachmentKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

interface NoteEditorProps {
  noteId: string;
  vaultPath: string;
  onError: (message: string) => void;
  onSaved?: () => void;
  /** The note changed shape externally (rename/icon from elsewhere, or a
   * step-8 reconciled reload) — force a fresh remount + refetch. */
  onNeedsReload?: () => void;
}

/**
 * Loads the note, then mounts `LoadedNoteEditor` keyed by id — BlockNote is
 * always created fresh with the correct `initialContent` for that note, never
 * reused/rehydrated across notes.
 */
export function NoteEditor({ noteId, vaultPath, onError, onSaved, onNeedsReload }: NoteEditorProps) {
  const [note, setNote] = useState<Note | null>(null);

  useEffect(() => {
    let cancelled = false;
    setNote(null);
    (async () => {
      try {
        const loaded = await notes.read(noteId);
        if (!cancelled) setNote(loaded);
      } catch (e) {
        if (!cancelled) onError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [noteId, onError]);

  if (!note) {
    return <div className="centered muted">Loading…</div>;
  }
  return (
    <LoadedNoteEditor
      key={note.id}
      note={note}
      vaultPath={vaultPath}
      onError={onError}
      onSaved={onSaved}
      onNeedsReload={onNeedsReload}
    />
  );
}

function LoadedNoteEditor({
  note,
  vaultPath,
  onError,
  onSaved,
  onNeedsReload,
}: {
  note: Note;
  vaultPath: string;
  onError: (message: string) => void;
  onSaved?: () => void;
  onNeedsReload?: () => void;
}) {
  // BlockNote's own document JSON, loaded verbatim (no transformation) — the
  // core treats blocks as opaque, validated-but-unmodeled JSON (Phase 1
  // preamble), so this is the one place the shape actually matters.
  const editor = useCreateBlockNote({
    initialContent: toInitialContent(note.blocks),
    // Attachments (Phase 2 step 1): BlockNote's built-in image/video/file blocks
    // upload through here. We route the bytes through Rust's content-addressed
    // store and store the returned vault-RELATIVE path in the block (portable —
    // survives moving/syncing the vault). No attachment bytes are written from
    // the frontend; the core owns all FS work.
    uploadFile: async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return attachments.import(attachmentKindFromMime(file.type), file.name, bytes);
    },
    // Turn the stored vault-relative path into a displayable asset URL at render
    // time (like note icons). Anything else (e.g. a pasted external URL) is left
    // untouched.
    resolveFileUrl: async (url: string) =>
      url.startsWith("attachments/") ? attachments.assetUrl(vaultPath, url) : url,
  });

  const [title, setTitle] = useState(note.title);
  const [icon, setIconState] = useState<Icon | null | undefined>(note.icon);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [reconcile, setReconcile] = useState<ReturnType<typeof decideReconciliation>>({ kind: "none" });

  // Kept current on every keystroke so whichever timer fires (debounce or
  // max-wait) always flushes the latest values, never a stale closure.
  const titleRef = useRef(note.title);
  const noteRef = useRef(note);
  // True from the first edit after load/save until the next successful save
  // — drives the step-8 clean-vs-dirty reconciliation branch.
  const isDirtyRef = useRef(false);
  // Set just before an intentional remount that must discard (not flush) any
  // pending edit — "take theirs" — so the unmount cleanup's safety-net flush
  // doesn't silently undo the discard.
  const discardOnUnmountRef = useRef(false);

  const flush = async () => {
    setSaveState("saving");
    try {
      const updated: Note = {
        ...noteRef.current,
        title: titleRef.current,
        blocks: editor.document as unknown as Note["blocks"],
      };
      await notes.save(updated);
      noteRef.current = updated;
      isDirtyRef.current = false;
      setSaveState("saved");
      onSaved?.();
    } catch (e) {
      onError(String(e));
    }
  };

  // Ref-indirected so the debounced-flush instance (created once) always
  // calls the latest `flush` closure rather than the one from first render.
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const debouncedRef = useRef<DebouncedFlush | null>(null);
  if (debouncedRef.current === null) {
    debouncedRef.current = createDebouncedFlush(() => void flushRef.current(), {
      debounceMs: DEBOUNCE_MS,
      maxWaitMs: MAX_WAIT_MS,
    });
  }

  // Never rename the file: title edits and body edits both flow through the
  // same `notes.save`, which writes back to the id-matched path (vault.rs).
  useEffect(() => {
    const debounced = debouncedRef.current!;
    return () => {
      if (discardOnUnmountRef.current) return; // "take theirs": discard, don't flush.
      // Switching notes (or unmounting) with unsaved edits pending: flush
      // immediately rather than discarding them, so at most a crash — never
      // a normal note switch — can lose the last debounce window.
      if (debounced.isPending()) {
        debounced.cancel();
        flushRef.current();
      }
    };
  }, []);

  const scheduleSave = () => {
    isDirtyRef.current = true;
    setSaveState("saving");
    debouncedRef.current!.schedule();
  };

  // Icon changes are discrete (not continuous typing like body/title), so
  // they save immediately rather than going through the debounce.
  async function setIcon(newIcon: Icon | null) {
    setSaveState("saving");
    try {
      const updated: Note = {
        ...noteRef.current,
        title: titleRef.current,
        blocks: editor.document as unknown as Note["blocks"],
        icon: newIcon ?? undefined,
      };
      await notes.save(updated);
      noteRef.current = updated;
      setIconState(newIcon);
      setSaveState("saved");
      onSaved?.();
    } catch (e) {
      onError(String(e));
    }
  }

  // Step 8: react to this specific note changing on disk for a reason other
  // than our own save (the self-write filter already excludes those).
  useEffect(() => {
    const unsubscribe = watcher.onNoteChangedExternally((changedId) => {
      if (changedId !== note.id) return;
      void (async () => {
        const stillExists = await notes
          .read(note.id)
          .then(() => true)
          .catch(() => false);

        const decision = decideReconciliation({ stillExists, isDirty: isDirtyRef.current });
        if (decision.kind === "none") {
          // Clean editor, file still exists: reload silently.
          discardOnUnmountRef.current = true;
          onNeedsReload?.();
          return;
        }
        setReconcile(decision);
      })();
    });
    return unsubscribe;
  }, [note.id, onNeedsReload]);

  function takeTheirs() {
    discardOnUnmountRef.current = true;
    debouncedRef.current?.cancel();
    setReconcile({ kind: "none" });
    onNeedsReload?.();
  }

  function keepMine() {
    debouncedRef.current?.cancel();
    setReconcile({ kind: "none" });
    void flush(); // overwrite what's now on disk with the current buffer.
  }

  function recreate() {
    setReconcile({ kind: "none" });
    void flush(); // save_note falls back to a fresh path when the id isn't in the index.
  }

  return (
    <div className="editor-pane">
      {reconcile.kind === "dirty-conflict" && (
        <div className="reconcile-banner">
          <span>This note changed on disk while you had unsaved edits.</span>
          <div className="reconcile-banner-actions">
            <button onClick={keepMine}>Keep mine</button>
            <button onClick={takeTheirs}>Take theirs</button>
          </div>
        </div>
      )}
      {reconcile.kind === "deleted" && (
        <div className="reconcile-banner">
          <span>This note was deleted outside the app.</span>
          <div className="reconcile-banner-actions">
            <button onClick={recreate}>Recreate</button>
          </div>
        </div>
      )}
      <div className="editor-header">
        <IconPicker
          onChange={setIcon}
          trigger={
            <button className="editor-icon-button" title="Set icon">
              <NoteIcon icon={icon} vaultPath={vaultPath} className="h-6 w-6" />
            </button>
          }
        />
        <Input
          className="h-auto border-none bg-transparent px-0 text-3xl font-bold shadow-none focus-visible:ring-0 dark:bg-transparent"
          value={title}
          placeholder="Untitled"
          onChange={(e) => {
            setTitle(e.target.value);
            titleRef.current = e.target.value;
            scheduleSave();
          }}
        />
      </div>
      <BlockNoteView
        editor={editor}
        onChange={scheduleSave}
        theme="light"
        className="min-h-0 flex-1"
      />
      <div className="status muted">
        {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
      </div>
    </div>
  );
}
