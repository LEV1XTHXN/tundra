//! Service layer — the ONE gateway between React and the Rust core, and the only
//! module allowed to import `@tauri-apps/api` (CLAUDE.md §2, §6.2 `services`).
//!
//! It wraps every generated command, unwrapping the tauri-specta `Result` into a
//! plain value or a thrown typed `CoreError`, so React never sees IPC plumbing.

import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { commands, events } from "./bindings";
import type { CoreError } from "./bindings";

export type {
  CoreError,
  Note,
  NoteSummary,
  NoteMeta,
  Block,
  Icon,
  VaultInfo,
  TreeNode,
  FolderNode,
  SearchHit,
  AttachmentKind,
} from "./bindings";
import type { AttachmentKind } from "./bindings";
import type { Note, NoteSummary, VaultInfo, TreeNode, SearchHit } from "./bindings";

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
  /** Create a note directly inside `folder` (relative to the notes root, `""` for the root). */
  createIn: (title: string, folder: string): Promise<Note> =>
    unwrap(commands.createNoteIn(title, folder)),
  read: (id: string): Promise<Note> => unwrap(commands.readNote(id)),
  save: (note: Note): Promise<null> => unwrap(commands.saveNote(note)),
  delete: (id: string): Promise<null> => unwrap(commands.deleteNote(id)),
  /** Move a note to a different folder (relative to the notes root, e.g. `"Biology/Plants"` or `""` for the root). */
  move: (id: string, folder: string): Promise<null> => unwrap(commands.moveNote(id, folder)),
};

/** Folder ops on real directories under `notes/`. Paths are `/`-separated and relative to the notes root. */
export const folders = {
  create: (path: string): Promise<null> => unwrap(commands.createFolder(path)),
  rename: (path: string, newName: string): Promise<null> =>
    unwrap(commands.renameFolder(path, newName)),
  move: (path: string, newParent: string): Promise<null> =>
    unwrap(commands.moveFolder(path, newParent)),
  delete: (path: string): Promise<null> => unwrap(commands.deleteFolder(path)),
};

/** The folder/note tree for the open vault. */
export const tree = (): Promise<TreeNode[]> => unwrap(commands.listTree());

/** Local full-text search (Phase 1 step 9) — the index lives under `.vault/cache/search/`. */
export const search = {
  /** Ranked hits (id, title, snippet) for `query`, most relevant first. */
  query: (query: string, limit: number): Promise<SearchHit[]> =>
    unwrap(commands.searchQuery(query, limit)),
  /** Rebuild the index from scratch — a recovery action; the index is derived/rebuildable. */
  rebuild: (): Promise<null> => unwrap(commands.rebuildIndex()),
};

/**
 * External-change notifications (Phase 1 step 8): the Rust file watcher
 * detects changes to the vault's `notes/` tree that weren't caused by this
 * app's own writes, and emits these. Exposed as typed subscribe functions
 * (each returning an unsubscribe callback) so the UI never touches
 * `@tauri-apps/api`'s raw event plumbing directly.
 */
export const watcher = {
  /** The folder/note tree changed on disk externally — refresh the nav tree. */
  onTreeChanged(callback: () => void): () => void {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void events.treeChanged.listen(() => callback()).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  },
  /** A note's content changed on disk externally (by id), not via this app's own save. */
  onNoteChangedExternally(callback: (id: string) => void): () => void {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void events.noteChangedExternally.listen((event) => callback(event.payload.id)).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  },
};

/**
 * Attachments (Phase 2 step 1) — content-addressed image/video/file embeds.
 * The editor reads a dropped/pasted/picked `File`'s bytes and forwards them
 * here; the core (Rust) hashes + stores them and returns a stable vault-relative
 * path. That relative path is what gets stored in the note (portable across
 * machines/vault moves); it is turned into a displayable URL only at render time
 * via `assetUrl`, exactly like custom note icons.
 */
export const attachments = {
  /** Import a file by content, returning its vault-relative hashed path. */
  import: (kind: AttachmentKind, fileName: string, bytes: Uint8Array): Promise<string> =>
    unwrap(commands.importAttachment(kind, fileName, Array.from(bytes))),
  /** A displayable asset URL for a stored vault-relative attachment path. */
  assetUrl: (vaultPath: string, relPath: string): string =>
    convertFileSrc(`${vaultPath}/${relPath}`),
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

/** Per-note icons (CLAUDE.md Phase 1 preamble): emoji codepoints render as
 * local Twemoji SVGs client-side (see `nav/twemoji.ts`) with no FS work.
 * Custom image icons need Rust (copying into `attachments/icons/`) and the
 * Tauri asset protocol (`convertFileSrc`) to display — both live here. */
export const icons = {
  /** Native file picker for choosing a custom icon image. */
  async pickFile(): Promise<string | null> {
    const selected = await openFolderDialog({
      directory: false,
      multiple: false,
      title: "Choose an icon image",
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp"] }],
    });
    return typeof selected === "string" ? selected : null;
  },
  /** Copy `srcPath` into `attachments/icons/`, returning its vault-relative path. */
  import: (srcPath: string): Promise<string> => unwrap(commands.importIcon(srcPath)),
  /** A displayable URL for a custom icon's vault-relative path. */
  assetUrl: (vaultPath: string, relPath: string): string =>
    convertFileSrc(`${vaultPath}/${relPath}`),
};
