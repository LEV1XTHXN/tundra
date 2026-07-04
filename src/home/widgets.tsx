/**
 * Home dashboard widgets (Phase 2 step 6). Each is a self-contained component
 * that reads its own data through `services` — Pinned and Recent list notes,
 * Quick capture appends to the quick-note scratchpad. They refetch when
 * `refreshKey` changes (the vault's notes changed). React renders; data via
 * services only.
 */
import { useEffect, useState } from "react";

import { notes, quickNote } from "@/services";
import type { Block, NoteSummary } from "@/services";
import { NoteIcon } from "@/nav/NoteIcon";

export interface WidgetProps {
  vaultPath: string;
  /** Bumps when the vault's notes change, so widgets refetch. */
  refreshKey: unknown;
  onOpenNote: (id: string) => void;
  onError: (message: string) => void;
}

function NoteList({
  items,
  vaultPath,
  onOpenNote,
  empty,
}: {
  items: NoteSummary[];
  vaultPath: string;
  onOpenNote: (id: string) => void;
  empty: string;
}) {
  if (items.length === 0) return <p className="widget-empty muted">{empty}</p>;
  return (
    <div className="home-note-list">
      {items.map((n) => (
        <button key={n.id} className="home-note-row" onClick={() => onOpenNote(n.id)}>
          <NoteIcon icon={n.icon} vaultPath={vaultPath} className="h-4 w-4" />
          <span className="home-note-title">{n.title || "Untitled"}</span>
        </button>
      ))}
    </div>
  );
}

/** Notes flagged `meta.pinned` (pin/unpin from the editor's pin button). */
export function PinnedWidget({ vaultPath, refreshKey, onOpenNote }: WidgetProps) {
  const [items, setItems] = useState<NoteSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    notes
      .list()
      .then((l) => {
        if (!cancelled) setItems(l.filter((n) => n.pinned));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);
  return (
    <NoteList
      items={items}
      vaultPath={vaultPath}
      onOpenNote={onOpenNote}
      empty="No pinned notes. Pin one from its editor (the pin icon)."
    />
  );
}

/** The most recently modified notes (`list_notes` is already modified-desc). */
export function RecentWidget({ vaultPath, refreshKey, onOpenNote }: WidgetProps) {
  const [items, setItems] = useState<NoteSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    notes
      .list()
      .then((l) => {
        if (!cancelled) setItems(l.slice(0, 8));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);
  return <NoteList items={items} vaultPath={vaultPath} onOpenNote={onOpenNote} empty="No notes yet." />;
}

/** Jot a thought straight into the quick-note scratchpad without leaving Home. */
export function QuickCaptureWidget({ onError }: WidgetProps) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "saved">("idle");

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      const note = await quickNote.read();
      const block: Block = {
        id: crypto.randomUUID(),
        type: "paragraph",
        content: [{ type: "text", text: trimmed, styles: {} }],
      };
      await quickNote.save({ ...note, blocks: [...(note.blocks ?? []), block] });
      setText("");
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1500);
    } catch (e) {
      onError(String(e));
    }
  };

  return (
    <div className="quick-capture">
      <textarea
        className="quick-capture-input"
        value={text}
        placeholder="Capture a quick thought — it lands in Quick notes…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="quick-capture-actions">
        <span className="muted">{status === "saved" ? "Added to Quick notes" : "Ctrl+Enter to add"}</span>
        <button className="new-note" onClick={() => void submit()} disabled={!text.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}
