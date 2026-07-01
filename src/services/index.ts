//! Service layer — the ONE gateway between React and the Rust core, and the only
//! module allowed to import `@tauri-apps/api` (CLAUDE.md §2, §6.2 `services`).
//!
//! It wraps every generated command, unwrapping the tauri-specta `Result` into a
//! plain value or a thrown typed `CoreError`, so React never sees IPC plumbing.

import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import { commands } from "./bindings";
import type { CoreError } from "./bindings";

export type {
  CoreError,
  Note,
  NoteSummary,
  NoteMeta,
  Block,
  Icon,
  VaultInfo,
} from "./bindings";
import type { Note, NoteSummary, VaultInfo } from "./bindings";

type CmdResult<T> = { status: "ok"; data: T } | { status: "error"; error: CoreError };

/** Unwrap a tauri-specta result, throwing the typed `CoreError` on failure. */
async function unwrap<T>(p: Promise<CmdResult<T>>): Promise<T> {
  const res = await p;
  if (res.status === "error") throw res.error;
  return res.data;
}

/** Vault lifecycle + onboarding. */
export const vault = {
  /** Suggested default vault path: `{Documents}/Tundra`. */
  defaultPath: (): Promise<string> => unwrap(commands.defaultVaultPath()),
  /** The last opened vault path, or `null` if the user must onboard. */
  last: (): Promise<string | null> => unwrap(commands.lastVault()),
  /** Open or create a vault at `path`, and remember it. */
  open: (path: string): Promise<VaultInfo> => unwrap(commands.openVault(path)),
  /** The currently open vault, or `null`. */
  current: (): Promise<VaultInfo | null> => unwrap(commands.currentVault()),
};

/** Note CRUD against the open vault. */
export const notes = {
  list: (): Promise<NoteSummary[]> => unwrap(commands.listNotes()),
  create: (title: string): Promise<Note> => unwrap(commands.createNote(title)),
  read: (id: string): Promise<Note> => unwrap(commands.readNote(id)),
  save: (note: Note): Promise<null> => unwrap(commands.saveNote(note)),
};

/** Native folder picker for onboarding — OS access via the Tauri dialog plugin. */
export async function pickVaultFolder(): Promise<string | null> {
  const selected = await openFolderDialog({
    directory: true,
    multiple: false,
    title: "Choose a vault folder",
  });
  return typeof selected === "string" ? selected : null;
}
