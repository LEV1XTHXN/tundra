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
  GraphData,
  GraphNode,
  GraphEdge,
} from "./bindings";
import type { AttachmentKind } from "./bindings";
import type { GraphData } from "./bindings";
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

/**
 * The single quick-note scratchpad (Phase 2 step 5) — a fast-capture space kept
 * OUTSIDE the notes tree (its own file at the vault root), so it never appears in
 * nav, search, links, or the graph. One document, always there; jot ideas here
 * and move them into real notes later.
 */
export const quickNote = {
  /** Read the scratchpad (a fresh empty note if nothing's been captured yet). */
  read: (): Promise<Note> => unwrap(commands.readQuickNote()),
  /** Persist the scratchpad. */
  save: (note: Note): Promise<null> => unwrap(commands.saveQuickNote(note)),
};

/**
 * Inter-note links & graph (Phase 2 step 2) — all derived by the Rust `links`
 * module from id-backed link nodes in the block tree. Links survive rename/move
 * because identity is the note's UUID; `resolveTitles` gives the CURRENT title
 * for live link labels.
 */
export const links = {
  /** Notes that link TO `id` (incoming), as current summaries — backlinks panel. */
  backlinks: (id: string): Promise<NoteSummary[]> => unwrap(commands.backlinks(id)),
  /** The whole directed graph (nodes = notes, edges = resolved links). */
  graph: (): Promise<GraphData> => unwrap(commands.graphData()),
  /** Resolve note ids to their current summaries; unresolved ids are omitted. */
  resolveTitles: (ids: string[]): Promise<NoteSummary[]> => unwrap(commands.resolveTitles(ids)),
  /** Rebuild the graph cache from disk (recovery — it's derived/rebuildable). */
  rebuild: (): Promise<null> => unwrap(commands.rebuildGraph()),
};

/**
 * Vault-scoped UI config (Phase 2 step 4+) — small JSON documents under
 * `.vault/config/` owned by Rust, NOT `localStorage` (CLAUDE.md §4 blacklist;
 * §5.2 `.vault/config` MAY sync). The graph view persists its settings here
 * (`graph-view.json`); the home dashboard layout follows in step 6 (`home.json`).
 * The boundary is a raw JSON string; `read`/`write` handle (de)serialization so
 * callers work with typed values.
 */
export const config = {
  /** The parsed config named `name`, or `null` if it was never written / is unreadable. */
  async read<T>(name: string): Promise<T | null> {
    const raw = await unwrap(commands.readVaultConfig(name));
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // A corrupt config file is treated as absent — it's rebuildable UI state,
      // never a source of truth, so we fall back to defaults instead of throwing.
      return null;
    }
  },
  /** Persist `value` (JSON-serialized) as the config named `name`, atomically via Rust. */
  write(name: string, value: unknown): Promise<null> {
    return unwrap(commands.writeVaultConfig(name, JSON.stringify(value)));
  },
};

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
 * glyphs from the bundled Twemoji COLR font client-side (see `nav/NoteIcon.tsx`)
 * with no FS work. Custom image icons need Rust (copying into
 * `attachments/icons/`) and the Tauri asset protocol (`convertFileSrc`) to
 * display — both live here. */
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
