/**
 * The note editor: loads a note, then mounts `LoadedNoteEditor` (keyed by id) as
 * a thin orchestrator that builds the BlockNote editor and composes the editor
 * hooks — persistence + reconciliation, typed links, templates, clipboard,
 * context menus, shortcuts — around the render. React renders only; every
 * read/write goes through the `services` layer, and this module never imports
 * `@tauri-apps/api` (checked by `npm run check:layering`).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FormattingToolbar,
  getFormattingToolbarItems,
  type FormattingToolbarProps,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";

import type { Note, NoteSummary } from "@/services";
import { useTheme } from "@/store/theme";
import { FileOpenButton } from "./FileOpenButton";
import { NoteBanner } from "./NoteBanner";
import { TemplatePicker } from "@/templates/TemplatePicker";
import { SaveAsTemplateDialog } from "@/templates/SaveAsTemplateDialog";
import { NOTE_LINK_TYPE } from "./NoteLink";
import { NoteLinkPicker } from "./NoteLinkPicker";
import { FindBar } from "./FindBar";
import { NOTE_PERSISTENCE, type NotePersistence } from "./persistence";
import { useNoteBlockEditor } from "./useNoteBlockEditor";
import { useNoteEditorPersistence } from "./useNoteEditorPersistence";
import { useTypedLinks } from "./useTypedLinks";
import { useEditorTemplates } from "./useEditorTemplates";
import { useEditorClipboard } from "./useEditorClipboard";
import { useEditorContextMenus } from "./useEditorContextMenus";
import { useEditorShortcuts } from "./useEditorShortcuts";
import { EditorHeader } from "./EditorHeader";
import { EditorContextMenu, SpellcheckMenu } from "./EditorMenus";
import { TableOfContents } from "./TableOfContents";

export { TEMPLATE_PERSISTENCE, type NotePersistence } from "./persistence";

interface NoteEditorProps {
  noteId: string;
  vaultPath: string;
  /** Where the document lives — defaults to the vault's notes. Pass
   *  {@link TEMPLATE_PERSISTENCE} to edit a template instead. */
  persistence?: NotePersistence;
  /** `"template"` hides note-only chrome (pin, use/save-template) and is used by
   *  the Templates manager; defaults to `"note"`. */
  mode?: "note" | "template";
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
export function NoteEditor({
  noteId,
  vaultPath,
  persistence = NOTE_PERSISTENCE,
  mode = "note",
  noteSummaries,
  onError,
  onSaved,
  onNeedsReload,
}: NoteEditorProps) {
  const [note, setNote] = useState<Note | null>(null);

  useEffect(() => {
    let cancelled = false;
    setNote(null);
    (async () => {
      try {
        const loaded = await persistence.read(noteId);
        if (!cancelled) setNote(loaded);
      } catch (e) {
        if (!cancelled) onError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [noteId, persistence, onError]);

  if (!note) {
    return <div className="centered muted">Loading…</div>;
  }
  return (
    <LoadedNoteEditor
      key={note.id}
      note={note}
      vaultPath={vaultPath}
      persistence={persistence}
      mode={mode}
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
  persistence,
  mode,
  noteSummaries,
  onError,
  onSaved,
  onNeedsReload,
}: {
  note: Note;
  vaultPath: string;
  persistence: NotePersistence;
  mode: "note" | "template";
  noteSummaries: Map<string, NoteSummary>;
  onError: (message: string) => void;
  onSaved?: () => void;
  onNeedsReload?: () => void;
}) {
  const isTemplateMode = mode === "template";
  const editor = useNoteBlockEditor({ note, vaultPath });
  const editorPaneRef = useRef<HTMLDivElement>(null);
  // Editor theme follows the app-wide Appearance setting (Phase 3 step 6);
  // BlockNote re-styles when the resolved theme flips.
  const resolvedTheme = useTheme((s) => s.resolved);

  const save = useNoteEditorPersistence({
    note,
    editor,
    persistence,
    // Only real notes count toward the usage streak — not template edits.
    countsTowardActivity: persistence === NOTE_PERSISTENCE,
    onError,
    onSaved,
    onNeedsReload,
  });

  const links = useTypedLinks({ editor, note, noteSummaries });
  const templates = useEditorTemplates({
    editor,
    icon: save.icon,
    scheduleSave: save.scheduleSave,
    markSaved: save.markSaved,
    onError,
  });

  useEditorClipboard({ editor, editorPaneRef, vaultPath, onError });
  const menus = useEditorContextMenus({ editor, editorPaneRef, onError });

  const [findOpen, setFindOpen] = useState(false);
  useEditorShortcuts({
    isTemplateMode,
    onCreateLink: links.openFromSelection,
    onFind: () => setFindOpen(true),
    onUseTemplate: () => templates.setTemplatePickerOpen(true),
  });

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

  const { spellMenu, formatMenu } = menus;
  const { linkPicker } = links;

  return (
    <>
      <div className="editor-pane" ref={editorPaneRef}>
        {findOpen && <FindBar view={editor.prosemirrorView} onClose={() => setFindOpen(false)} />}
        {spellMenu && (
          <SpellcheckMenu
            ctx={spellMenu}
            onReplace={(word) => menus.replaceMisspelling(spellMenu, word)}
            onAddToDictionary={() => menus.addToDictionary(spellMenu)}
            onClose={() => menus.setSpellMenu(null)}
          />
        )}
        {save.reconcile.kind === "dirty-conflict" && (
          <div className="reconcile-banner">
            <span>This note changed on disk while you had unsaved edits.</span>
            <div className="reconcile-banner-actions">
              <button onClick={save.keepMine}>Keep mine</button>
              <button onClick={save.takeTheirs}>Take theirs</button>
            </div>
          </div>
        )}
        {save.reconcile.kind === "deleted" && (
          <div className="reconcile-banner">
            <span>This note was deleted outside the app.</span>
            <div className="reconcile-banner-actions">
              <button onClick={save.recreate}>Recreate</button>
            </div>
          </div>
        )}
        {!isTemplateMode && save.banner && (
          <NoteBanner banner={save.banner} vaultPath={vaultPath} onChange={(b) => void save.setBanner(b)} />
        )}
        <EditorHeader
          vaultPath={vaultPath}
          isTemplateMode={isTemplateMode}
          icon={save.icon}
          onIconChange={save.setIcon}
          title={save.title}
          onTitleChange={save.setTitle}
          pinned={save.pinned}
          onTogglePin={() => void save.togglePin()}
          banner={save.banner}
          onBannerChange={(b) => void save.setBanner(b)}
          onUseTemplate={() => templates.setTemplatePickerOpen(true)}
          onSaveAsTemplate={() => templates.setSaveAsTemplateOpen(true)}
        />
        <BlockNoteView
          editor={editor}
          onChange={() => {
            // Typed-link handling (open the `[[` picker, upgrade `[[Title]]`) runs
            // before the save so the persisted tree carries id-backed link nodes.
            links.onEditorChange();
            save.scheduleSave();
          }}
          theme={resolvedTheme}
          formattingToolbar={false}
        >
          {formatMenu && (
            <EditorContextMenu x={formatMenu.x} y={formatMenu.y} onClose={() => menus.setFormatMenu(null)}>
              <CustomFormattingToolbar />
            </EditorContextMenu>
          )}
        </BlockNoteView>
        <NoteLinkPicker
          open={linkPicker.open}
          onOpenChange={(o) => links.setLinkPicker((p) => ({ ...p, open: o }))}
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
      {!isTemplateMode && (
        <>
          <TemplatePicker
            open={templates.templatePickerOpen}
            onOpenChange={templates.setTemplatePickerOpen}
            onPick={(t) => void templates.applyTemplate(t.id)}
          />
          <SaveAsTemplateDialog
            open={templates.saveAsTemplateOpen}
            onOpenChange={templates.setSaveAsTemplateOpen}
            defaultName={save.title}
            onSave={(name) => void templates.saveAsTemplate(name)}
          />
        </>
      )}
      {/* Table-of-contents minimap — a sibling of .editor-pane so it anchors to
          the non-scrolling .main-pane (like .status below) and stays pinned to
          the right edge while the note scrolls. Hidden in the Templates manager. */}
      {!isTemplateMode && <TableOfContents editor={editor} scrollRef={editorPaneRef} />}
      {/* Save-state indicator: a sibling of .editor-pane (not a child), so it
          anchors to the non-scrolling .main-pane and stays pinned to its
          bottom-left corner regardless of note length or scroll (see .status). */}
      <div className="status" aria-live="polite">
        {save.saveState === "saving" ? "Saving…" : save.saveState === "saved" ? "Saved" : ""}
      </div>
    </>
  );
}
