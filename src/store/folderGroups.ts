import { create } from "zustand";

import { config, type Icon } from "@/services";

/**
 * User-defined groups of top-level folders — collapsible sidebar sections that
 * organize the tree without changing anything on disk. A group is a purely
 * presentational overlay (folders stay real directories directly under the notes
 * root), so — like folder views and tag colors — it lives in vault config
 * (`.vault/config/folder-groups.json`) via the config passthrough, not in the
 * note format.
 *
 * Membership is by top-level folder path and is a set (display order still comes
 * from the root folder's own sort). A folder belongs to at most one group; when
 * a grouped folder is renamed/moved/deleted the caller reconciles membership via
 * {@link renameFolder} / {@link dropFolder}.
 */
export interface FolderGroup {
  id: string;
  name: string;
  icon?: Icon;
  /** Top-level folder paths (single path segment) assigned to this group. */
  folders: string[];
  collapsed?: boolean;
}

interface StoredGroups {
  groups: FolderGroup[];
}

const CONFIG_NAME = "folder-groups";

interface FolderGroupsState {
  groups: FolderGroup[];
  loaded: boolean;
  /** Load groups for the open vault (call after a vault opens). */
  load: () => Promise<void>;
  /** Create a group and return its id. */
  create: (name: string) => Promise<string>;
  rename: (id: string, name: string) => Promise<void>;
  setIcon: (id: string, icon: Icon | null) => Promise<void>;
  setCollapsed: (id: string, collapsed: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Assign `folderPath` to `groupId` (moving it out of any other group), or pass
   *  `null` to ungroup it. */
  assign: (folderPath: string, groupId: string | null) => Promise<void>;
  /** A grouped folder was renamed — follow it so it stays in its group. */
  renameFolder: (oldPath: string, newPath: string) => Promise<void>;
  /** A folder was deleted or moved out of the top level — drop it from all groups. */
  dropFolder: (path: string) => Promise<void>;
}

export const useFolderGroups = create<FolderGroupsState>((set, get) => {
  const persist = async (groups: FolderGroup[]) => {
    set({ groups });
    await config.write(CONFIG_NAME, { groups } satisfies StoredGroups);
  };
  /** Remove a folder path from every group (used by assign/rename/drop). */
  const without = (groups: FolderGroup[], path: string): FolderGroup[] =>
    groups.map((g) => (g.folders.includes(path) ? { ...g, folders: g.folders.filter((f) => f !== path) } : g));

  return {
    groups: [],
    loaded: false,
    load: async () => {
      const stored = await config.read<StoredGroups>(CONFIG_NAME);
      set({ groups: stored?.groups ?? [], loaded: true });
    },
    create: async (name) => {
      const id = crypto.randomUUID();
      const group: FolderGroup = { id, name: name.trim() || "New group", folders: [] };
      await persist([...get().groups, group]);
      return id;
    },
    rename: async (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      await persist(get().groups.map((g) => (g.id === id ? { ...g, name: trimmed } : g)));
    },
    setIcon: async (id, icon) => {
      await persist(
        get().groups.map((g) => (g.id === id ? { ...g, icon: icon ?? undefined } : g)),
      );
    },
    setCollapsed: async (id, collapsed) => {
      await persist(get().groups.map((g) => (g.id === id ? { ...g, collapsed } : g)));
    },
    remove: async (id) => {
      await persist(get().groups.filter((g) => g.id !== id));
    },
    assign: async (folderPath, groupId) => {
      const cleared = without(get().groups, folderPath);
      const next =
        groupId === null
          ? cleared
          : cleared.map((g) => (g.id === groupId ? { ...g, folders: [...g.folders, folderPath] } : g));
      await persist(next);
    },
    renameFolder: async (oldPath, newPath) => {
      if (oldPath === newPath) return;
      const groups = get().groups;
      if (!groups.some((g) => g.folders.includes(oldPath))) return;
      await persist(
        groups.map((g) =>
          g.folders.includes(oldPath)
            ? { ...g, folders: g.folders.map((f) => (f === oldPath ? newPath : f)) }
            : g,
        ),
      );
    },
    dropFolder: async (path) => {
      const groups = get().groups;
      if (!groups.some((g) => g.folders.includes(path))) return;
      await persist(without(groups, path));
    },
  };
});
