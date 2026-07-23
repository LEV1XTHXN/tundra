/**
 * The **Tags** view — the vault's tags as first-class things. Left: every tag in
 * use, with how many notes carry it; right: those notes, click to open.
 *
 * Counts and the note list are derived from the `NoteSummary` map the shell
 * already holds (Rust mirrors `meta.tags` into the summary, so no extra reads),
 * while tag *mutations* — rename, delete, color — go through `services` and the
 * tag stores. Kanban-owned tags are shown but not deletable here: they belong to
 * their board column, the same rule Settings ▸ Tags enforces.
 */
import { useMemo, useState } from "react";
import { Check, Pencil, Trash2 } from "lucide-react";
import { tags as tagsService } from "@/services";
import type { NoteSummary } from "@/services";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errorMessage";
import { ViewFrame } from "@/components/ViewFrame";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { NoteIcon } from "@/nav/NoteIcon";
import {
  kanbanTagChipStyle,
  tagChipStyle,
  TAG_PALETTE,
  useKanbanTags,
  useTagColors,
  useVaultTags,
} from "@/store/tagColors";

interface TagsViewProps {
  vaultPath: string;
  noteSummaries: Map<string, NoteSummary>;
  onOpenNote: (id: string) => void;
  /** Re-read the note summaries after a vault-wide tag rename/delete — the
   *  counts and the note list here are derived from them, and every other
   *  surface showing tag chips needs the same refresh. */
  onChanged: () => void;
  onError: (msg: string | null) => void;
}

export function TagsView({
  vaultPath,
  noteSummaries,
  onOpenNote,
  onChanged,
  onError,
}: TagsViewProps) {
  const vaultTags = useVaultTags((s) => s.tags);
  const reloadVaultTags = useVaultTags((s) => s.load);
  const colors = useTagColors((s) => s.colors);
  const setColor = useTagColors((s) => s.setColor);
  const kanbanTags = useKanbanTags((s) => s.tags);

  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  /** tag -> the notes carrying it, title-sorted. One pass over the summaries. */
  const notesByTag = useMemo(() => {
    const map = new Map<string, NoteSummary[]>();
    for (const note of noteSummaries.values()) {
      for (const tag of note.tags ?? []) {
        const list = map.get(tag);
        if (list) list.push(note);
        else map.set(tag, [note]);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.title.localeCompare(b.title));
    }
    return map;
  }, [noteSummaries]);

  const q = filter.trim().toLowerCase();
  const visibleTags = q ? vaultTags.filter((t) => t.toLowerCase().includes(q)) : vaultTags;
  const activeTag = selected && vaultTags.includes(selected) ? selected : null;
  const activeNotes = activeTag ? (notesByTag.get(activeTag) ?? []) : [];

  const chipStyle = (tag: string) =>
    kanbanTags.has(tag) ? kanbanTagChipStyle(colors[tag]) : tagChipStyle(colors[tag]);

  const commitRename = async (from: string) => {
    const to = renameValue.trim();
    setRenaming(null);
    if (!to || to === from) return;
    try {
      await tagsService.rename(from, to);
      // Carry the color over to the new name, then drop the old entry.
      const color = colors[from];
      if (color) {
        await setColor(to, color);
        await setColor(from, null);
      }
      await reloadVaultTags();
      onChanged();
      setSelected(to);
    } catch (e) {
      onError(errorMessage(e));
    }
  };

  const deleteTag = async (tag: string) => {
    try {
      await tagsService.delete(tag);
      await setColor(tag, null); // the tag no longer exists — drop its color
      await reloadVaultTags();
      onChanged();
      if (selected === tag) setSelected(null);
    } catch (e) {
      onError(errorMessage(e));
    }
  };

  return (
    <ViewFrame
      title="Tags"
      subtitle={`${vaultTags.length} ${vaultTags.length === 1 ? "tag" : "tags"} in this vault`}
      fullBleed
    >
      <div className="tags-view">
        <div className="tags-list-pane">
          {vaultTags.length > 0 && (
            <input
              className="tags-filter"
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search tags…"
              aria-label="Search tags"
            />
          )}

          {vaultTags.length === 0 ? (
            <p className="muted tags-empty">
              No tags yet — add tags to a note from its info panel.
            </p>
          ) : visibleTags.length === 0 ? (
            <p className="muted tags-empty">No tags match “{filter.trim()}”.</p>
          ) : (
            <ul className="tags-list">
              {visibleTags.map((tag) => {
                const managed = kanbanTags.has(tag);
                return (
                  <li key={tag}>
                    {renaming === tag ? (
                      <input
                        autoFocus
                        className="tags-rename"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => void commitRename(tag)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void commitRename(tag);
                          else if (e.key === "Escape") setRenaming(null);
                        }}
                      />
                    ) : (
                      <ContextMenu>
                        <ContextMenuTrigger asChild>
                          <button
                            className={cn("tags-row", tag === activeTag && "active")}
                            onClick={() => setSelected(tag)}
                          >
                            <span className="tags-chip" style={chipStyle(tag)}>
                              #{tag}
                            </span>
                            <span className="tags-count">{notesByTag.get(tag)?.length ?? 0}</span>
                          </button>
                        </ContextMenuTrigger>
                        <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
                          <ContextMenuLabel>Color</ContextMenuLabel>
                          <div className="tags-swatches">
                            {TAG_PALETTE.map((c) => (
                              <button
                                key={c}
                                className="tags-swatch"
                                style={{ backgroundColor: c }}
                                title={c}
                                aria-label={`Color #${tag} ${c}`}
                                onClick={() => void setColor(tag, c)}
                              >
                                {colors[tag] === c && <Check className="h-3 w-3" />}
                              </button>
                            ))}
                            <button
                              className="tags-swatch tags-swatch-clear"
                              title="No color"
                              aria-label={`Clear color for #${tag}`}
                              onClick={() => void setColor(tag, null)}
                            >
                              ✕
                            </button>
                          </div>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            onSelect={() => {
                              setRenameValue(tag);
                              setRenaming(tag);
                            }}
                          >
                            <Pencil /> Rename
                          </ContextMenuItem>
                          {managed ? (
                            <ContextMenuItem disabled>Managed by a Kanban column</ContextMenuItem>
                          ) : (
                            <ContextMenuItem
                              variant="destructive"
                              onSelect={() => void deleteTag(tag)}
                            >
                              <Trash2 /> Delete from all notes
                            </ContextMenuItem>
                          )}
                        </ContextMenuContent>
                      </ContextMenu>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="tags-notes-pane">
          {!activeTag ? (
            <p className="muted">Select a tag to see the notes carrying it.</p>
          ) : activeNotes.length === 0 ? (
            <p className="muted">No notes carry #{activeTag}.</p>
          ) : (
            <ul className="tags-notes">
              {activeNotes.map((note) => (
                <li key={note.id}>
                  <button className="tags-note-row" onClick={() => onOpenNote(note.id)}>
                    <NoteIcon icon={note.icon} vaultPath={vaultPath} className="h-4 w-4 shrink-0" />
                    <span className="nav-row-label">{note.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ViewFrame>
  );
}
