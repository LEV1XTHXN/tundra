import { notes, templates } from "@/services";
import type { Note } from "@/services";

/**
 * How the editor loads and persists its document. Notes go through `notes`;
 * templates through `templates` — same `Note` shape and editor, different files
 * (templates live outside `notes/`). Everything else in the editor is identical,
 * so a single component drives both, parameterized by this and `mode`.
 */
export interface NotePersistence {
  read: (id: string) => Promise<Note>;
  save: (note: Note) => Promise<null>;
}

/** Persistence for a real vault note (the default). */
export const NOTE_PERSISTENCE: NotePersistence = { read: notes.read, save: notes.save };
/** Persistence for editing a template document (Templates manager). */
export const TEMPLATE_PERSISTENCE: NotePersistence = { read: templates.read, save: templates.save };
