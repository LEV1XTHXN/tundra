/**
 * Note metadata inspector — a collapsible right-hand drawer holding everything
 * *about* the open note (as opposed to its content): stats and backlinks now,
 * with room to grow (tags, outgoing links, dates of related events, …). Kept out
 * of the writing surface so the editor stays uncluttered; toggled from the shell
 * and slid off-screen when closed so it costs no space.
 *
 * React renders only — all data comes through `services` (note read + backlinks);
 * no `@tauri-apps/api` here (checked by `npm run check:layering`).
 */
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { PanelRightClose, Plus, X } from "lucide-react";

import { links, notes, tags as tagsService } from "@/services";
import type { Note, NoteSummary } from "@/services";
import { NoteIcon } from "@/nav/NoteIcon";
import { noteStats } from "@/editor/noteStats";
import { useViewState } from "@/store/viewState";
import {
  TAG_PALETTE,
  kanbanTagChipStyle,
  tagChipStyle,
  useKanbanTags,
  useTagColors,
  useVaultTags,
} from "@/store/tagColors";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Absolute datetime, localized, e.g. "4 Jul 2026, 11:07". */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function NoteInspector({
  noteId,
  vaultPath,
  refreshKey,
  open,
  onClose,
}: {
  noteId: string;
  vaultPath: string;
  /** Bumps when the vault's notes change (a save/rename) so stats + backlinks refetch. */
  refreshKey: unknown;
  open: boolean;
  onClose: () => void;
}) {
  const [note, setNote] = useState<Note | null>(null);
  const [backlinks, setBacklinks] = useState<NoteSummary[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const openNote = useViewState((s) => s.openNote);
  const tagColors = useTagColors((s) => s.colors);
  const setTagColor = useTagColors((s) => s.setColor);
  const kanbanTags = useKanbanTags((s) => s.tags);
  const vaultTags = useVaultTags((s) => s.tags);
  const reloadVaultTags = useVaultTags((s) => s.load);

  const noteTags = note?.meta?.tags ?? [];

  // Every tag already used somewhere in the vault becomes a one-click suggestion
  // in the add menu, filtered by what's typed and minus the ones already on this
  // note. Sourced from the live `useVaultTags` pool so a tag created on any note
  // shows up here immediately. Kanban-column tags are deliberately excluded:
  // they're applied only by dragging a note into the column, never by hand.
  const suggestions = useMemo(() => {
    const applied = new Set(noteTags);
    const q = tagDraft.trim().toLowerCase();
    return vaultTags
      .filter(
        (t) =>
          !applied.has(t) && !kanbanTags.has(t) && (q === "" || t.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [noteTags, tagDraft, vaultTags, kanbanTags]);

  /** A tag owned by a Kanban column can't be added/renamed to by hand. */
  const draftIsKanban = kanbanTags.has(tagDraft.trim());

  // Tag edits go through the core (which owns meta.tags + the index). We re-read
  // the note afterward so the panel reflects the canonical, normalized set —
  // rather than optimistically guessing at trimming/dedup rules the core applies.
  // Also refresh the vault-wide tag pool so a newly created (or now-unused) tag
  // is reflected in the suggestion list right away.
  async function reloadNote() {
    try {
      setNote(await notes.read(noteId));
      void reloadVaultTags();
    } catch {
      /* leave the last-known note on a transient read error */
    }
  }
  async function addTag(value?: string) {
    const t = (value ?? tagDraft).trim();
    if (!t) return;
    // Kanban-column tags are managed by drag-and-drop on the board, not added by
    // hand here — leave the field open so the inline hint explains why.
    if (kanbanTags.has(t)) return;
    setTagDraft("");
    setAddOpen(false);
    try {
      await tagsService.add(noteId, t);
      await reloadNote();
    } catch {
      /* ignore — a failed add leaves tags unchanged */
    }
  }
  async function removeTag(tag: string) {
    try {
      await tagsService.remove(noteId, tag);
      await reloadNote();
    } catch {
      /* ignore */
    }
  }
  // Rename globally: the core rewrites *every* note carrying `oldTag` so the name
  // stays consistent across the vault (never a per-note fork). The tag's color
  // follows it to the new name, and the now-defunct old name's color is cleared.
  async function renameTag(oldTag: string, nextRaw: string) {
    const next = nextRaw.trim();
    if (!next || next === oldTag) return;
    // Can't rename a tag into (or out of) Kanban ownership by hand — those tags
    // are driven solely by column membership.
    if (kanbanTags.has(next) || kanbanTags.has(oldTag)) return;
    const color = tagColors[oldTag];
    try {
      await tagsService.rename(oldTag, next);
      if (color != null) {
        await setTagColor(next, color);
        await setTagColor(oldTag, null);
      }
      await reloadNote();
    } catch {
      /* ignore — a failed rename leaves tags unchanged */
    }
  }

  useEffect(() => {
    // Only fetch while open — no point re-reading the note on every save when
    // the panel is collapsed. Refetches on open, note switch, or vault change.
    if (!open) return;
    let cancelled = false;
    Promise.all([notes.read(noteId), links.backlinks(noteId)])
      .then(([n, b]) => {
        if (cancelled) return;
        setNote(n);
        setBacklinks(b);
      })
      .catch(() => {
        /* leave the last-known values on a transient read error */
      });
    return () => {
      cancelled = true;
    };
  }, [noteId, refreshKey, open]);

  const stats = useMemo(() => (note ? noteStats(note.blocks) : null), [note]);

  return (
    <aside className={`inspector${open ? " open" : ""}`} aria-hidden={!open}>
      <div className="inspector-header">
        <span className="inspector-title">Note info</span>
        <button className="inspector-close" onClick={onClose} title="Close panel" aria-label="Close panel">
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      <div className="inspector-body">
        <section className="inspector-section">
          <h3 className="inspector-section-title">Details</h3>
          <dl className="inspector-fields">
            <div>
              <dt>Words</dt>
              <dd>{stats ? stats.words.toLocaleString() : "—"}</dd>
            </div>
            <div>
              <dt>Characters</dt>
              <dd>{stats ? stats.characters.toLocaleString() : "—"}</dd>
            </div>
            <div>
              <dt>Links out</dt>
              <dd>{stats ? stats.linksOut : "—"}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{note ? formatDate(note.created) : "—"}</dd>
            </div>
            <div>
              <dt>Modified</dt>
              <dd>{note ? formatDate(note.modified) : "—"}</dd>
            </div>
          </dl>
        </section>

        <section className="inspector-section">
          <h3 className="inspector-section-title">
            Tags{noteTags.length > 0 && <span className="muted"> ({noteTags.length})</span>}
          </h3>
          <div className="inspector-tags">
            {noteTags.map((t) => (
              <TagChip
                key={t}
                tag={t}
                color={tagColors[t]}
                isKanban={kanbanTags.has(t)}
                style={kanbanTags.has(t) ? kanbanTagChipStyle(tagColors[t]) : tagChipStyle(tagColors[t])}
                onSetColor={(c) => void setTagColor(t, c)}
                onRename={(next) => void renameTag(t, next)}
                onRemove={() => void removeTag(t)}
              />
            ))}
          </div>
          <Popover
            open={addOpen}
            onOpenChange={(o) => {
              setAddOpen(o);
              if (!o) setTagDraft("");
            }}
          >
            <PopoverTrigger asChild>
              <button className="inspector-tag-add-btn" title="Add a tag">
                <Plus className="h-3.5 w-3.5" />
                Add tag
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="inspector-tag-popover">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void addTag();
                }}
              >
                <input
                  className="inspector-tag-input"
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  placeholder="Tag name…"
                  autoFocus
                />
              </form>
              {draftIsKanban && (
                <p className="inspector-tag-hint muted">
                  #{tagDraft.trim()} is a Kanban tag — add it by dragging the note into that column.
                </p>
              )}
              {suggestions.length > 0 && (
                <ul className="inspector-tag-suggestions">
                  {suggestions.map((t) => (
                    <li key={t}>
                      <button
                        type="button"
                        className="inspector-tag-suggestion"
                        onClick={() => void addTag(t)}
                      >
                        <span
                          className="inspector-tag-suggestion-dot"
                          style={{ background: tagColors[t] ?? "var(--muted-foreground)" }}
                        />
                        #{t}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </PopoverContent>
          </Popover>
        </section>

        <section className="inspector-section">
          <h3 className="inspector-section-title">
            Backlinks{backlinks.length > 0 && <span className="muted"> ({backlinks.length})</span>}
          </h3>
          {backlinks.length === 0 ? (
            <p className="inspector-empty muted">No notes link here yet.</p>
          ) : (
            backlinks.map((s) => (
              <button key={s.id} className="backlink-row" onClick={() => openNote(s.id)}>
                <NoteIcon icon={s.icon} vaultPath={vaultPath} className="h-4 w-4" />
                <span className="backlink-title">{s.title || "Untitled"}</span>
              </button>
            ))
          )}
        </section>
      </div>
    </aside>
  );
}

/**
 * A single applied tag: the pill shows `#tag`; clicking it opens a menu to both
 * rename the tag (text field, top) and recolor it (swatches, below). The trailing
 * ✕ removes it. Rename/color state is local so each chip's popover is independent.
 */
function TagChip({
  tag,
  color,
  isKanban,
  style,
  onSetColor,
  onRename,
  onRemove,
}: {
  tag: string;
  color?: string;
  /** Owned by a Kanban column — rename is disabled (drag the card instead). */
  isKanban: boolean;
  style: CSSProperties;
  onSetColor: (color: string | null) => void;
  onRename: (next: string) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(tag);

  function commitRename() {
    onRename(draft);
    setOpen(false);
  }

  return (
    <span className="inspector-tag" style={style}>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) setDraft(tag); // reset the field to the current name each time it opens
        }}
      >
        <PopoverTrigger asChild>
          <button className="inspector-tag-label" title={`Edit #${tag}`}>
            #{tag}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="inspector-color-popover">
          {isKanban ? (
            <p className="inspector-tag-hint muted">
              Managed by a Kanban column — move the note between columns to change it.
            </p>
          ) : (
            <form
              className="inspector-tag-rename"
              onSubmit={(e) => {
                e.preventDefault();
                commitRename();
              }}
            >
              <input
                className="inspector-tag-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                }}
                placeholder="Tag name…"
                aria-label={`Rename #${tag}`}
                autoFocus
              />
            </form>
          )}
          <div className="kanban-swatches">
            <button
              type="button"
              className={`kanban-swatch none${color == null ? " selected" : ""}`}
              onClick={() => onSetColor(null)}
              title="No color"
              aria-label="No color"
            />
            {TAG_PALETTE.map((c) => (
              <button
                type="button"
                key={c}
                className={`kanban-swatch${color === c ? " selected" : ""}`}
                style={{ background: c }}
                onClick={() => onSetColor(c)}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <button
        className="inspector-tag-remove"
        onClick={onRemove}
        title={`Remove #${tag}`}
        aria-label={`Remove tag ${tag}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
