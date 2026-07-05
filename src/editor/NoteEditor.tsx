/**
 * Phase 1 step 4: the real BlockNote editor, replacing the Phase 0 textarea
 * skeleton. Step 8 adds external-change reconciliation: clean editor -> file
 * changed externally -> reload silently; dirty editor -> file changed ->
 * banner (keep mine / take theirs), never auto-overwrite; file deleted ->
 * keep the buffer, offer to recreate. React renders only — every read/write
 * goes through the `services` layer; this module never imports
 * `@tauri-apps/api` (checked by `npm run check:layering`).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Pin } from "lucide-react";
import {
  useCreateBlockNote,
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  type FormattingToolbarProps,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { FileOpenButton } from "./FileOpenButton";

import { attachments, notes, watcher } from "@/services";
import type { AttachmentKind, Icon, Note, NoteSummary } from "@/services";
import { Input } from "@/components/ui/input";
import { NoteIcon } from "@/nav/NoteIcon";
import { IconPicker } from "@/nav/IconPicker";
import { toInitialContent } from "./blockContent";
import { createDebouncedFlush, type DebouncedFlush } from "./debouncedFlush";
import { decideReconciliation } from "./reconcile";
import { editorSchema } from "./schema";
import { NOTE_LINK_TYPE } from "./NoteLink";
import { convertTypedLinks, type Inline, type LinkTarget } from "./typedLinks";
import { NoteLinkPicker } from "./NoteLinkPicker";
import { FindBar } from "./FindBar";
import { useKeybindings } from "@/store/keybindings";
import { matchCommand } from "@/keybindings/binding";

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
  /** Current note summaries (id + title) — drives the backlinks panel refresh
   * and the `[[` link menu; changes whenever the nav tree refreshes. */
  noteSummaries: Map<string, NoteSummary>;
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
export function NoteEditor({ noteId, vaultPath, noteSummaries, onError, onSaved, onNeedsReload }: NoteEditorProps) {
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
      noteSummaries={noteSummaries}
      onError={onError}
      onSaved={onSaved}
      onNeedsReload={onNeedsReload}
    />
  );
}

function LoadedNoteEditor({
  note,
  vaultPath,
  noteSummaries,
  onError,
  onSaved,
  onNeedsReload,
}: {
  note: Note;
  vaultPath: string;
  noteSummaries: Map<string, NoteSummary>;
  onError: (message: string) => void;
  onSaved?: () => void;
  onNeedsReload?: () => void;
}) {
  // BlockNote's own document JSON, loaded verbatim (no transformation) — the
  // core treats blocks as opaque, validated-but-unmodeled JSON (Phase 1
  // preamble), so this is the one place the shape actually matters.
  const editor = useCreateBlockNote({
    // Shared schema with the custom `noteLink` inline node (Phase 2 step 3).
    schema: editorSchema,
    // Opaque block JSON from the core; the editor's exact PartialBlock type for
    // the custom schema isn't worth reconstructing here (blocks are validated
    // but unmodeled by the core — Phase 1 preamble).
    initialContent: toInitialContent(note.blocks) as never,
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
    // Web links: use BlockNote's built-in behaviour — select text and paste a
    // URL over it (or Ctrl+K) to create a link. BlockNote's default paste
    // already parses Markdown, so no custom pasteHandler is needed. (We tried a
    // `[text](url)` typing input rule, but it didn't fire reliably in the
    // WebKitGTK webview, so we dropped it in favour of the built-in path.)
  });

  // Word → note linking (Phase 2 step 3): select text, run the `link.create`
  // shortcut (default Ctrl+Shift+K), pick a note; the selected word becomes a
  // link whose display text is kept.
  // `display` = text the link renders as (the selected word for Ctrl+Shift+K, ""
  // for the `[[` trigger which renders the target's live title). `trailingSpace`
  // is set for the `[[` path so a space is inserted after the atomic link node,
  // giving the caret editable text to land in — the old inline menu did this.
  const [linkPicker, setLinkPicker] = useState<{
    open: boolean;
    display: string;
    trailingSpace: boolean;
  }>({
    open: false,
    display: "",
    trailingSpace: false,
  });
  // Find-in-note bar (default Ctrl+F), opened by the `search.inNote` keybinding.
  const [findOpen, setFindOpen] = useState(false);

  // Windows Explorer's "copy" on a file puts BOTH a file entry and a
  // text/plain path onto the clipboard. BlockNote's own paste handler picks
  // among clipboard types by a fixed priority list that ranks text/plain
  // ahead of "Files" (see @blocknote/core's fromClipboard), so it silently
  // pastes the path as text instead of the actual image. Intercept in the
  // capture phase — which runs before ProseMirror's own paste listener,
  // bound directly to the editor's DOM node — and prefer the real file
  // whenever the clipboard actually carries one.
  const editorPaneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = editorPaneRef.current;
    if (!container) return;
    function onPasteCapture(event: ClipboardEvent) {
      const files = event.clipboardData?.files;
      if (!files || files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      void (async () => {
        let ref = editor.getTextCursorPosition().block;
        for (const file of Array.from(files)) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const url = await attachments.import(attachmentKindFromMime(file.type), file.name, bytes);
          // BlockNote's own upload flow (drag-and-drop) sets props.name from the
          // File object up front; this paste path bypasses that flow entirely; so
          // without this, pasted files show a blank name next to the icon.
          const [inserted] = editor.insertBlocks(
            [{ type: attachmentKindFromMime(file.type), props: { url, name: "_" } } as never],
            ref,
            "after",
          );
          ref = inserted;
        }
      })();
    }
    container.addEventListener("paste", onPasteCapture, true);
    return () => container.removeEventListener("paste", onPasteCapture, true);
  }, [editor]);

  // Clicking a "file" block opens it directly (image/video blocks already
  // render inline, so an unexpected external-open on click there would be
  // surprising — this is scoped to plain file attachments only, which
  // otherwise show just an icon + name with no built-in interaction).
  useEffect(() => {
    const container = editorPaneRef.current;
    if (!container) return;
    function onClick(event: MouseEvent) {
      const target = event.target as HTMLElement;
      const wrapper = target.closest(".bn-file-block-content-wrapper");
      if (!wrapper) return;
      const blockEl = wrapper.closest("[data-id]");
      const blockId = blockEl?.getAttribute("data-id");
      if (!blockId) return;
      const block = editor.getBlock(blockId);
      if (block?.type !== "file" || !block.props.url) return;
      attachments.openFile(vaultPath, block.props.url as string).catch((e) => onError(String(e)));
    }
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, [editor, vaultPath, onError]);

  // The two editor-scoped shortcuts read their combos from the shared keybinding
  // store (rebindable in Settings); App owns the global ones. Both listeners use
  // the same `matchCommand` matcher and act only on their own command ids.
  const bindings = useKeybindings((s) => s.bindings);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const cmd = matchCommand(e, bindings);
      if (cmd === "link.create") {
        e.preventDefault();
        setLinkPicker({ open: true, display: editor.getSelectedText(), trailingSpace: false });
      } else if (cmd === "search.inNote") {
        e.preventDefault();
        setFindOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editor, bindings]);

  // Manually typed / pasted `[[Title]]` → link node (bug fix). A title→target
  // lookup over the current summaries (case-insensitive, self excluded), so the
  // converter captures the target's id + real title once, exactly like the menu.
  const titleToTarget = useMemo(() => {
    const map = new Map<string, LinkTarget>();
    noteSummaries.forEach((s) => {
      if (s.id === note.id) return; // no self-links
      const key = s.title.trim().toLowerCase();
      if (key && !map.has(key)) map.set(key, { id: s.id, title: s.title });
    });
    return map;
  }, [noteSummaries, note.id]);

  // Swap out BlockNote's built-in file-download button (see FileOpenButton.tsx
  // for why) while keeping every other default toolbar item as-is. Memoized so
  // the toolbar component identity stays stable across re-renders (typing).
  const CustomFormattingToolbar = useMemo(() => {
    return function CustomFormattingToolbar(toolbarProps: FormattingToolbarProps) {
      return (
        <FormattingToolbar>
          {getFormattingToolbarItems(toolbarProps.blockTypeSelectItems).map((item) =>
            item.key === "fileDownloadButton" ? (
              <FileOpenButton key="fileDownloadButton" vaultPath={vaultPath} onError={onError} />
            ) : (
              item
            ),
          )}
        </FormattingToolbar>
      );
    };
  }, [vaultPath, onError]);

  // Guards against the re-entrant onChange that `updateBlock` itself fires while
  // we're mid-conversion (which would otherwise recurse before converging).
  const convertingRef = useRef(false);

  function maybeConvertTypedLinks() {
    if (convertingRef.current) return;
    const block = editor.getTextCursorPosition().block;
    const content = block.content;
    // Only inline-content blocks (paragraph/heading/list item…); table content
    // and the like isn't a flat inline array — skip it.
    if (!Array.isArray(content)) return;
    const { changed, content: next } = convertTypedLinks(
      content as unknown as Inline[],
      (t) => titleToTarget.get(t.toLowerCase()),
      NOTE_LINK_TYPE,
    );
    if (!changed) return;
    convertingRef.current = true;
    try {
      editor.updateBlock(block, { content: next as never });
      // Keep typing flowing after the atomic link (and its trailing space).
      editor.setTextCursorPosition(block, "end");
    } finally {
      convertingRef.current = false;
    }
  }

  // Typing `[[` opens the note picker — the SAME cmdk palette as Ctrl+Shift+K and
  // global search, so arrow-key navigation + Enter work reliably. It replaces
  // BlockNote's inline suggestion menu, whose two-character trigger and keyboard
  // handling are unreliable on WebKitGTK (see typedLinks.ts). We spot the two
  // brackets at a collapsed cursor, delete them, and open the picker; on pick the
  // link is inserted at that spot (ProseMirror keeps the collapsed selection over
  // the modal, exactly like the Ctrl+Shift+K path).
  function maybeOpenLinkPicker() {
    if (linkPicker.open) return;
    const view = editor.prosemirrorView;
    if (!view) return;
    const { from, empty } = view.state.selection;
    if (!empty || from < 2) return;
    if (view.state.doc.textBetween(from - 2, from) !== "[[") return;
    view.dispatch(view.state.tr.delete(from - 2, from));
    setLinkPicker({ open: true, display: "", trailingSpace: true });
  }

  const [title, setTitle] = useState(note.title);
  const [icon, setIconState] = useState<Icon | null | undefined>(note.icon);
  const [pinned, setPinned] = useState<boolean>(note.meta?.pinned ?? false);
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

  // Pin/unpin (Phase 2 step 6): a discrete meta change, saved immediately like
  // the icon. Drives the Home dashboard's Pinned widget.
  async function togglePin() {
    const next = !pinned;
    setSaveState("saving");
    try {
      const current = noteRef.current;
      const updated: Note = {
        ...current,
        title: titleRef.current,
        blocks: editor.document as unknown as Note["blocks"],
        meta: { ...(current.meta ?? { pinned: false, tags: [] }), pinned: next },
      };
      await notes.save(updated);
      noteRef.current = updated;
      setPinned(next);
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
    <>
    <div className="editor-pane" ref={editorPaneRef}>
      {findOpen && <FindBar view={editor.prosemirrorView} onClose={() => setFindOpen(false)} />}
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
        <button
          className={`editor-icon-button${pinned ? " pinned" : ""}`}
          onClick={() => void togglePin()}
          title={pinned ? "Unpin from Home" : "Pin to Home"}
          aria-pressed={pinned}
        >
          <Pin className="h-5 w-5" fill={pinned ? "currentColor" : "none"} />
        </button>
      </div>
      <BlockNoteView
        editor={editor}
        onChange={() => {
          // Typing `[[` opens the keyboard-navigable note picker (checked first so
          // the brackets are stripped before anything else looks at the text).
          maybeOpenLinkPicker();
          // Upgrade any just-completed `[[Title]]` to a link before saving, so
          // the persisted block tree carries the id-backed node, not literal text.
          maybeConvertTypedLinks();
          scheduleSave();
        }}
        theme="light"
        formattingToolbar={false}
      >
        <FormattingToolbarController formattingToolbar={CustomFormattingToolbar} />
      </BlockNoteView>
      <NoteLinkPicker
        open={linkPicker.open}
        onOpenChange={(o) => setLinkPicker((p) => ({ ...p, open: o }))}
        currentNoteId={note.id}
        display={linkPicker.display}
        onPick={(n) => {
          // The editor kept its selection while the picker had focus (ProseMirror
          // preserves it): Ctrl+Shift+K had a word selected, so inserting replaces
          // it (display text stays that word); the `[[` path had a collapsed cursor,
          // so it inserts there and appends a space so the caret can leave the link.
          editor.insertInlineContent([
            { type: NOTE_LINK_TYPE, props: { noteId: n.id, label: n.title, display: linkPicker.display } },
            ...(linkPicker.trailingSpace ? [" "] : []),
          ]);
        }}
      />
      {/* Scroll-past-end room, BELOW the backlinks panel — lets the last line (or
          the backlinks) rise toward the top without burying the panel (which the
          old in-editor `padding-bottom: 60vh` did). */}
      <div className="editor-tail-space" aria-hidden="true" />
    </div>
    {/* Save-state indicator: a sibling of .editor-pane (not a child), so it
        anchors to the non-scrolling .main-pane and stays pinned to its
        bottom-left corner regardless of note length or scroll (see .status). */}
    <div className="status" aria-live="polite">
      {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
    </div>
    </>
  );
}
