/**
 * Backlinks panel (Phase 2 step 3): the notes that link *to* the open note,
 * derived by the Rust `links` module. Refetches when the open note changes or
 * when the vault's notes change (a new incoming link appears after another note
 * is saved → the nav tree refreshes → `refreshKey` changes). Each row opens
 * that note. Data flows through `services`; no `@tauri-apps/api` here.
 */
import { useEffect, useState } from "react";

import { links } from "@/services";
import type { NoteSummary } from "@/services";
import { NoteIcon } from "@/nav/NoteIcon";
import { useViewState } from "@/store/viewState";

export function BacklinksPanel({
  noteId,
  vaultPath,
  refreshKey,
}: {
  noteId: string;
  vaultPath: string;
  refreshKey: unknown;
}) {
  const [items, setItems] = useState<NoteSummary[]>([]);
  const setOpenNoteId = useViewState((s) => s.setOpenNoteId);

  useEffect(() => {
    let cancelled = false;
    links
      .backlinks(noteId)
      .then((b) => {
        if (!cancelled) setItems(b);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId, refreshKey]);

  if (items.length === 0) return null;

  return (
    <div className="backlinks-panel">
      <div className="backlinks-title">
        Linked from <span className="backlinks-count">{items.length}</span>
      </div>
      {items.map((s) => (
        <button key={s.id} className="backlink-row" onClick={() => setOpenNoteId(s.id)}>
          <NoteIcon icon={s.icon} vaultPath={vaultPath} className="h-4 w-4" />
          <span className="backlink-title">{s.title || "Untitled"}</span>
        </button>
      ))}
    </div>
  );
}
