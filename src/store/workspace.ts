import { create } from "zustand";

import { config } from "@/services";

/**
 * Persisted sidebar workspace layout — right now, which folders are expanded in
 * the nav tree.
 *
 * Expansion used to live in `viewState` (in memory only), so every relaunch
 * dropped the user back to a fully-collapsed tree. It is presentation state, not
 * note content, so — like folder views, folder groups and the Kanban board's
 * collapsed columns — it lives in vault config (`.vault/config/workspace.json`)
 * via the config passthrough, keyed by the folder's `/`-separated path relative
 * to the notes root. Vault-scoped rather than app-scoped: the paths only mean
 * anything inside the vault they came from.
 *
 * Group collapse is NOT here — a group's `collapsed` flag already persists with
 * the group itself in `folder-groups.json`.
 *
 * Stale paths (a folder renamed, moved or deleted) are reconciled by the callers
 * that perform those mutations, via {@link renameFolder} / {@link dropFolder} —
 * the same contract the `folderGroups` store uses.
 */
const CONFIG_NAME = "workspace";

interface StoredWorkspace {
  /** Vault-relative paths of every expanded folder. */
  expandedFolders: string[];
}

/** True when `path` is `root` itself or nested anywhere beneath it. */
function isSelfOrDescendant(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

interface WorkspaceState {
  expandedFolders: ReadonlySet<string>;
  loaded: boolean;
  /** Load the layout for the open vault (call after a vault opens). */
  load: () => Promise<void>;
  /** Expand a collapsed folder / collapse an expanded one. */
  toggleFolder: (path: string) => Promise<void>;
  /** Expand `path` if it isn't already — used to reveal a freshly created child. */
  expandFolder: (path: string) => Promise<void>;
  /** A folder was renamed or moved — follow it (and its expanded descendants)
   *  to the new path so the tree looks the same afterwards. */
  renameFolder: (oldPath: string, newPath: string) => Promise<void>;
  /** A folder was deleted — forget it and everything under it. */
  dropFolder: (path: string) => Promise<void>;
}

export const useWorkspace = create<WorkspaceState>((set, get) => {
  const persist = async (expandedFolders: ReadonlySet<string>) => {
    // State first, disk after: the tree redraws immediately, the file catches up.
    set({ expandedFolders });
    try {
      await config.write(CONFIG_NAME, {
        expandedFolders: [...expandedFolders],
      } satisfies StoredWorkspace);
    } catch (e) {
      // Disposable layout state — a failed write costs the user nothing this
      // session, and the callers here are mid-operation (creating a note,
      // deleting a folder). Never fail their flow over it; the same reason
      // `config.read` treats a corrupt config as absent.
      console.warn("could not persist sidebar layout", e);
    }
  };

  return {
    expandedFolders: new Set(),
    loaded: false,
    load: async () => {
      const stored = await config.read<StoredWorkspace>(CONFIG_NAME);
      set({ expandedFolders: new Set(stored?.expandedFolders ?? []), loaded: true });
    },
    toggleFolder: async (path) => {
      const next = new Set(get().expandedFolders);
      if (!next.delete(path)) next.add(path);
      await persist(next);
    },
    expandFolder: async (path) => {
      if (get().expandedFolders.has(path)) return;
      await persist(new Set(get().expandedFolders).add(path));
    },
    renameFolder: async (oldPath, newPath) => {
      if (oldPath === newPath) return;
      const current = get().expandedFolders;
      const moved = [...current].filter((p) => isSelfOrDescendant(p, oldPath));
      if (moved.length === 0) return;
      const next = new Set([...current].filter((p) => !isSelfOrDescendant(p, oldPath)));
      // Re-root each affected path: only the `oldPath` prefix changes, the
      // nesting below it is untouched.
      for (const p of moved) next.add(newPath + p.slice(oldPath.length));
      await persist(next);
    },
    dropFolder: async (path) => {
      const current = get().expandedFolders;
      const next = new Set([...current].filter((p) => !isSelfOrDescendant(p, path)));
      if (next.size === current.size) return;
      await persist(next);
    },
  };
});
