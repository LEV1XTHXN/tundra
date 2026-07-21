import { useEffect, useRef, useState } from "react";

import { notes, watcher } from "@/services";
import type { Banner, Icon, Note } from "@/services";
import { useActivity } from "@/store/activity";
import { createDebouncedFlush, type DebouncedFlush } from "./debouncedFlush";
import { decideReconciliation, type ReconcileDecision } from "./reconcile";
import { mergeNote, type NotePatch } from "./noteMerge";
import type { NotePersistence } from "./persistence";
import type { NoteBlockEditor } from "./useNoteBlockEditor";

const DEBOUNCE_MS = 600;
const MAX_WAIT_MS = 2500;

interface Params {
  note: Note;
  editor: NoteBlockEditor;
  persistence: NotePersistence;
  /** Whether saving this document counts toward the usage streak — true for real
   *  notes, false for template edits (`persistence === NOTE_PERSISTENCE`). */
  countsTowardActivity: boolean;
  onError: (message: string) => void;
  onSaved?: () => void;
  onNeedsReload?: () => void;
}

export interface NoteEditorPersistence {
  /** Editable note metadata, mirrored as React state so the header re-renders. */
  title: string;
  icon: Icon | null | undefined;
  pinned: boolean;
  banner: Banner | null | undefined;
  /** Set the title (state + ref) and schedule a debounced save. */
  setTitle: (value: string) => void;
  /** Discrete meta changes — saved immediately (not debounced) like the icon. */
  setIcon: (icon: Icon | null) => Promise<void>;
  togglePin: () => Promise<void>;
  setBanner: (banner: Banner | null) => Promise<void>;
  /** Schedule a debounced body save (call from the editor's `onChange`). */
  scheduleSave: () => void;
  /** Mark the document saved without writing (used after save-as-template). */
  markSaved: () => void;
  saveState: "idle" | "saving" | "saved";
  /** External-change reconciliation banner state + its resolutions. */
  reconcile: ReconcileDecision;
  keepMine: () => void;
  takeTheirs: () => void;
  recreate: () => void;
}

/**
 * The note editor's save engine and external-change reconciliation (Phase 1
 * preamble). Owns the debounced/atomic autosave, discrete metadata saves
 * (icon/pin/banner, all via {@link mergeNote}), and the step-8 clean/dirty/
 * deleted policy — the pure decision lives in `reconcile.ts`; the dirty/discard/
 * flush machinery stays here because it all shares the same refs.
 *
 * Never renames the file: title edits and body edits both flow through the same
 * `persistence.save`, which writes back to the id-matched path (vault.rs).
 */
export function useNoteEditorPersistence({
  note,
  editor,
  persistence,
  countsTowardActivity,
  onError,
  onSaved,
  onNeedsReload,
}: Params): NoteEditorPersistence {
  const [title, setTitleState] = useState(note.title);
  const [icon, setIconState] = useState<Icon | null | undefined>(note.icon);
  const [pinned, setPinned] = useState<boolean>(note.meta?.pinned ?? false);
  const [banner, setBannerState] = useState<Banner | null | undefined>(note.meta?.banner);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [reconcile, setReconcile] = useState<ReconcileDecision>({ kind: "none" });

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
      const updated = mergeNote(noteRef.current, {
        title: titleRef.current,
        blocks: editor.document as unknown as Note["blocks"],
      });
      await persistence.save(updated);
      noteRef.current = updated;
      isDirtyRef.current = false;
      setSaveState("saved");
      // Only real notes count toward the usage streak — not template edits.
      if (countsTowardActivity) useActivity.getState().recordActivity();
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

  const setTitle = (value: string) => {
    setTitleState(value);
    titleRef.current = value;
    scheduleSave();
  };

  // Discrete meta changes save immediately (not debounced like the body): build
  // the next note from the live title/blocks + patch, persist, then reflect it in
  // local state. One path for icon/pin/banner instead of three copies.
  async function saveMeta(patch: NotePatch, apply: () => void) {
    setSaveState("saving");
    try {
      const updated = mergeNote(noteRef.current, {
        title: titleRef.current,
        blocks: editor.document as unknown as Note["blocks"],
        ...patch,
      });
      await persistence.save(updated);
      noteRef.current = updated;
      apply();
      setSaveState("saved");
      onSaved?.();
    } catch (e) {
      onError(String(e));
    }
  }

  const setIcon = (newIcon: Icon | null) => saveMeta({ icon: newIcon ?? undefined }, () => setIconState(newIcon));
  const togglePin = () => {
    const next = !pinned;
    return saveMeta({ pinned: next }, () => setPinned(next));
  };
  const setBanner = (newBanner: Banner | null) =>
    saveMeta({ banner: newBanner ?? undefined }, () => setBannerState(newBanner));

  const markSaved = () => setSaveState("saved");

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

  return {
    title,
    icon,
    pinned,
    banner,
    setTitle,
    setIcon,
    togglePin,
    setBanner,
    scheduleSave,
    markSaved,
    saveState,
    reconcile,
    keepMine,
    takeTheirs,
    recreate,
  };
}
