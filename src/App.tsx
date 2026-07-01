/**
 * Phase 0 walking skeleton (CLAUDE.md §7): choose vault → create note → type →
 * persist JSON → reopen. React only renders and dispatches user actions; every
 * bit of data flows through the `services` layer to the Rust core.
 *
 * The editor here is a deliberately minimal textarea. The real BlockNote editor
 * arrives in Phase 1 — for now we map the note's first paragraph block to plain
 * text just to prove the persistence loop end-to-end.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { notes, pickVaultFolder, vault } from "./services";
import type { CoreError, Note, NoteSummary, VaultInfo } from "./services";

function errorMessage(err: unknown): string {
  const e = err as Partial<CoreError>;
  if (e && typeof e === "object" && "kind" in e) {
    const m = (e as CoreError).message;
    return typeof m === "string" ? `${e.kind}: ${m}` : String(e.kind);
  }
  return String(err);
}

/** Read the plain-text body out of a note's first block (skeleton mapping). */
function bodyOf(note: Note): string {
  const content = note.blocks?.[0]?.content;
  return typeof content === "string" ? content : "";
}

/** Rebuild a note with an edited title + body, preserving the first block's id. */
function withEdits(note: Note, title: string, body: string): Note {
  const firstId = note.blocks?.[0]?.id ?? crypto.randomUUID();
  return {
    ...note,
    title,
    blocks: [{ id: firstId, type: "paragraph", content: body, children: [] }],
  };
}

export default function App() {
  const [vaultInfo, setVaultInfo] = useState<VaultInfo | null>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [noteList, setNoteList] = useState<NoteSummary[]>([]);
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const saveTimer = useRef<number | undefined>(undefined);

  const refreshNotes = useCallback(async () => {
    setNoteList(await notes.list());
  }, []);

  // On launch, reopen the last vault so returning users skip onboarding.
  useEffect(() => {
    (async () => {
      try {
        const last = await vault.last();
        if (last) {
          const info = await vault.open(last);
          setVaultInfo(info);
          await refreshNotes();
        }
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBooting(false);
      }
    })();
  }, [refreshNotes]);

  const openVaultAt = useCallback(
    async (path: string) => {
      setError(null);
      try {
        const info = await vault.open(path);
        setVaultInfo(info);
        await refreshNotes();
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [refreshNotes],
  );

  const onChooseFolder = useCallback(async () => {
    const path = await pickVaultFolder();
    if (path) await openVaultAt(path);
  }, [openVaultAt]);

  const onUseDefault = useCallback(async () => {
    try {
      await openVaultAt(await vault.defaultPath());
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [openVaultAt]);

  const openNote = useCallback(async (id: string) => {
    try {
      const note = await notes.read(id);
      setActiveNote(note);
      setTitle(note.title);
      setBody(bodyOf(note));
      setSaveState("idle");
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const onNewNote = useCallback(async () => {
    try {
      const note = await notes.create("Untitled");
      await refreshNotes();
      setActiveNote(note);
      setTitle(note.title);
      setBody(bodyOf(note));
      setSaveState("idle");
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [refreshNotes]);

  // Debounced, autosave-on-edit. Atomicity is handled in Rust (§8.6).
  const scheduleSave = useCallback(
    (nextTitle: string, nextBody: string) => {
      if (!activeNote) return;
      setSaveState("saving");
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(async () => {
        try {
          const updated = withEdits(activeNote, nextTitle, nextBody);
          await notes.save(updated);
          setActiveNote(updated);
          setSaveState("saved");
          await refreshNotes();
        } catch (e) {
          setError(errorMessage(e));
        }
      }, 500);
    },
    [activeNote, refreshNotes],
  );

  if (booting) {
    return <div className="centered muted">Loading…</div>;
  }

  if (!vaultInfo) {
    return (
      <div className="centered onboarding">
        <h1>Tundra</h1>
        <p className="muted">Choose where your notes live.</p>
        <div className="actions">
          <button onClick={onChooseFolder}>Choose a folder…</button>
          <button className="primary" onClick={onUseDefault}>
            Use default vault
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="vault-name" title={vaultInfo.path}>
          {vaultInfo.name}
        </div>
        <button className="new-note" onClick={onNewNote}>
          + New note
        </button>
        <ul className="note-list">
          {noteList.map((n) => (
            <li
              key={n.id}
              className={n.id === activeNote?.id ? "active" : ""}
              onClick={() => openNote(n.id)}
            >
              {n.title || "Untitled"}
            </li>
          ))}
          {noteList.length === 0 && <li className="muted empty">No notes yet</li>}
        </ul>
      </aside>

      <main className="editor">
        {activeNote ? (
          <>
            <input
              className="title-input"
              value={title}
              placeholder="Untitled"
              onChange={(e) => {
                setTitle(e.target.value);
                scheduleSave(e.target.value, body);
              }}
            />
            <textarea
              className="body-input"
              value={body}
              placeholder="Start writing…"
              onChange={(e) => {
                setBody(e.target.value);
                scheduleSave(title, e.target.value);
              }}
            />
            <div className="status muted">
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
            </div>
          </>
        ) : (
          <div className="centered muted">Select or create a note.</div>
        )}
      </main>

      {error && <div className="error toast">{error}</div>}
    </div>
  );
}
