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
import { PanelRightClose } from "lucide-react";

import { links, notes } from "@/services";
import type { Note, NoteSummary } from "@/services";
import { NoteIcon } from "@/nav/NoteIcon";
import { noteStats } from "@/editor/noteStats";
import { useViewState } from "@/store/viewState";

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
  const openNote = useViewState((s) => s.openNote);

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
