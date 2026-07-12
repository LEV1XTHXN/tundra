import type { Icon, NoteSummary, TreeNode } from "@/services";
import {
  folderKey,
  noteKey,
  type FolderView,
  type SortDir,
  type TreeSortField,
} from "@/store/folderViews";

/**
 * One visible row in the nav tree — a folder header or a note. Produced by
 * flattening only the *expanded* parts of the tree, so the row list stays
 * proportional to what's actually visible, not the whole vault (this is what
 * `@tanstack/react-virtual` virtualizes: CLAUDE.md Phase 1 preamble's ~50k-note
 * scale target).
 */
export type NavRow =
  | {
      /** A user-defined group of top-level folders (a collapsible sidebar section). */
      kind: "group";
      id: string;
      name: string;
      icon: Icon | null | undefined;
      collapsed: boolean;
      /** How many of the group's folders actually exist (for the header count). */
      folderCount: number;
    }
  | {
      kind: "folder";
      path: string;
      name: string;
      icon: Icon | null | undefined;
      /** Containing folder path (`""` = root) — used for drag-reordering among siblings. */
      parent: string;
      depth: number;
      expanded: boolean;
      hasChildren: boolean;
      /** The group this (top-level) folder belongs to, if any — for drag/unassign. */
      groupId: string | null;
    }
  | {
      kind: "note";
      id: string;
      title: string;
      icon: Icon | null | undefined;
      /** Containing folder path (`""` = root) — used for drag-reordering among siblings. */
      parent: string;
      depth: number;
    };

/**
 * The folder (relative to the notes root, `""` for root) a note lives in,
 * derived from its vault-relative `path` (e.g. `"notes/Biology/cell.json"`
 * -> `"Biology"`). Used to target "new note" at the currently open note's folder.
 */
export function folderOfNotePath(relPath: string): string {
  const withoutNotesPrefix = relPath.replace(/^notes[\\/]/, "");
  const parts = withoutNotesPrefix.split(/[\\/]/);
  parts.pop(); // drop the filename
  return parts.join("/");
}

/**
 * Move `draggedKey` to just before/after `targetKey` within `orderedSiblingKeys`
 * (the folder's children in current display order), returning the new full order
 * to persist as that folder's `manualOrder`. A no-op if the target vanished.
 */
export function reorderKeys(
  orderedSiblingKeys: string[],
  draggedKey: string,
  targetKey: string,
  position: "before" | "after",
): string[] {
  if (draggedKey === targetKey) return orderedSiblingKeys;
  const without = orderedSiblingKeys.filter((k) => k !== draggedKey);
  const targetIdx = without.indexOf(targetKey);
  if (targetIdx === -1) return orderedSiblingKeys;
  without.splice(position === "before" ? targetIdx : targetIdx + 1, 0, draggedKey);
  return without;
}

/** How a folder's direct children are ordered, resolved from its {@link FolderView}. */
type Ordering = (nodes: TreeNode[], view: FolderView, getView: (path: string) => FolderView) => TreeNode[];

const dirFactor = (dir: SortDir): number => (dir === "desc" ? -1 : 1);

/** Compare two note summaries by the chosen field (ascending; caller applies direction). */
function compareNotesByField(a: NoteSummary, b: NoteSummary, field: TreeSortField): number {
  switch (field) {
    case "modified":
      return a.modified.localeCompare(b.modified);
    case "created":
      return a.created.localeCompare(b.created);
    case "size":
      return (a.size ?? 0) - (b.size ?? 0);
    case "name":
    case "manual":
      return (a.title || "Untitled").localeCompare(b.title || "Untitled", undefined, { sensitivity: "base" });
  }
}

/**
 * Order a folder's direct children for the sidebar tree. Rules (locked with the
 * user): for a field sort, folders render above notes (folders by name, notes by
 * the chosen field); for a manual sort, folders and notes interleave in the
 * user's drag order, with anything unlisted falling to the bottom in a stable
 * order.
 */
const orderChildren: Ordering = (nodes, view) => {
  const sort = view.treeSort ?? { by: "manual", dir: "asc" };
  const factor = dirFactor(sort.dir);

  // Stable base index so equal keys keep their incoming (disk-walk) order.
  const indexed = nodes.map((node, i) => ({ node, i }));

  if (sort.by === "manual") {
    const order = view.manualOrder ?? [];
    const keyOf = (n: TreeNode) => (n.kind === "Folder" ? folderKey(n.data.name) : noteKey(n.data.id));
    const rankOf = (n: TreeNode) => {
      const idx = order.indexOf(keyOf(n));
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    };
    indexed.sort((x, y) => {
      const r = rankOf(x.node) - rankOf(y.node);
      return r !== 0 ? r : x.i - y.i;
    });
    return indexed.map((e) => e.node);
  }

  // Field sort: folders-before-notes, then the field.
  indexed.sort((x, y) => {
    const groupA = x.node.kind === "Folder" ? 0 : 1;
    const groupB = y.node.kind === "Folder" ? 0 : 1;
    if (groupA !== groupB) return groupA - groupB;

    if (x.node.kind === "Folder" && y.node.kind === "Folder") {
      const c = x.node.data.name.localeCompare(y.node.data.name, undefined, { sensitivity: "base" });
      return c !== 0 ? c * factor : x.i - y.i;
    }
    if (x.node.kind === "Note" && y.node.kind === "Note") {
      const c = compareNotesByField(x.node.data, y.node.data, sort.by);
      return c !== 0 ? c * factor : x.i - y.i;
    }
    return x.i - y.i;
  });
  return indexed.map((e) => e.node);
};

/** Build a folder NavRow. `groupId` is set only for top-level folders shown
 *  under a group header (used for drag/unassign); nested folders pass `null`. */
function folderRow(
  folder: FolderNodeData,
  parentPath: string,
  depth: number,
  expanded: boolean,
  icon: Icon | null | undefined,
  groupId: string | null,
): NavRow {
  return {
    kind: "folder",
    path: folder.path,
    name: folder.name,
    icon,
    parent: parentPath,
    depth,
    expanded,
    hasChildren: folder.children.length > 0,
    groupId,
  };
}

/** The `data` payload of a `Folder` TreeNode (name/path/children). */
type FolderNodeData = Extract<TreeNode, { kind: "Folder" }>["data"];

/**
 * Flatten the folder/note tree into a linear row list, respecting which folders
 * are expanded and each folder's own sort/manual order (from `getView`). Used
 * for subtrees below the top level; {@link flattenWithGroups} is the entrypoint
 * that lays out the top level (groups + ungrouped).
 */
export function flattenTree(
  nodes: TreeNode[],
  expandedFolders: ReadonlySet<string>,
  getView: (path: string) => FolderView,
  parentPath = "",
  depth = 0,
): NavRow[] {
  const rows: NavRow[] = [];
  const ordered = orderChildren(nodes, getView(parentPath), getView);
  for (const node of ordered) {
    if (node.kind === "Folder") {
      const folder = node.data;
      const isExpanded = expandedFolders.has(folder.path);
      rows.push(folderRow(folder, parentPath, depth, isExpanded, getView(folder.path).icon, null));
      if (isExpanded) {
        rows.push(...flattenTree(folder.children, expandedFolders, getView, folder.path, depth + 1));
      }
    } else {
      const note = node.data;
      rows.push({
        kind: "note",
        id: note.id,
        title: note.title || "Untitled",
        icon: note.icon,
        parent: parentPath,
        depth,
      });
    }
  }
  return rows;
}

/** Minimal view of a folder group needed to lay out the sidebar (see the
 *  `folderGroups` store's `FolderGroup`). */
export interface NavGroup {
  id: string;
  name: string;
  icon?: Icon;
  /** Top-level folder paths assigned to this group, in the user's order. */
  folders: string[];
  collapsed?: boolean;
}

/** Manual-order / drag key for a folder group. */
export const groupKey = (id: string) => `group:${id}`;

/**
 * Lay out the whole sidebar: user-defined folder groups (each a collapsible
 * header with its assigned top-level folders nested under it) interleaved with
 * everything ungrouped (top-level folders not in any group, plus root-level
 * notes) at the root depth. Grouped folders' own subtrees flatten normally
 * beneath them.
 *
 * **Ordering.** In the root's *manual* sort (the default, and what dragging
 * switches to), groups, ungrouped folders, and root notes share one order — the
 * root's `manualOrder`, which now also carries `group:<id>` keys — so the user
 * can arrange all three freely. In a *field* sort, groups render first (in their
 * stored order), then the field-sorted ungrouped items, since a group has no
 * field to sort by.
 *
 * Group membership only applies to TOP-LEVEL folders; a folder listed in a group
 * but no longer present on disk is skipped (a rename/move ejects it, which the
 * caller reconciles). A folder claimed by more than one group shows under the
 * first that lists it.
 */
export function flattenWithGroups(
  nodes: TreeNode[],
  groups: readonly NavGroup[],
  expandedFolders: ReadonlySet<string>,
  getView: (path: string) => FolderView,
): NavRow[] {
  const rootView = getView("");
  const ordered = orderChildren(nodes, rootView, getView);
  const folderByPath = new Map<string, FolderNodeData>();
  for (const n of ordered) if (n.kind === "Folder") folderByPath.set(n.data.path, n.data);

  // First-claimer wins, so a folder never renders under two groups.
  const claimedBy = new Map<string, string>();
  for (const g of groups) {
    for (const path of g.folders) {
      if (folderByPath.has(path) && !claimedBy.has(path)) claimedBy.set(path, g.id);
    }
  }

  const rows: NavRow[] = [];
  const emitFolder = (folder: FolderNodeData, depth: number, groupId: string | null) => {
    const isExpanded = expandedFolders.has(folder.path);
    rows.push(folderRow(folder, "", depth, isExpanded, getView(folder.path).icon, groupId));
    if (isExpanded) {
      rows.push(...flattenTree(folder.children, expandedFolders, getView, folder.path, depth + 1));
    }
  };
  const emitNote = (note: Extract<TreeNode, { kind: "Note" }>["data"]) =>
    rows.push({ kind: "note", id: note.id, title: note.title || "Untitled", icon: note.icon, parent: "", depth: 0 });
  const emitGroup = (g: NavGroup) => {
    // Grouped folders render in their manual-order position (via `ordered`).
    const groupFolders = ordered.filter(
      (n): n is Extract<TreeNode, { kind: "Folder" }> =>
        n.kind === "Folder" && claimedBy.get(n.data.path) === g.id,
    );
    rows.push({ kind: "group", id: g.id, name: g.name, icon: g.icon, collapsed: g.collapsed === true, folderCount: groupFolders.length });
    if (g.collapsed) return;
    for (const n of groupFolders) emitFolder(n.data, 1, g.id);
  };

  const manual = (rootView.treeSort?.by ?? "manual") === "manual";
  if (manual) {
    // One order for groups + ungrouped folders + root notes.
    const order = rootView.manualOrder ?? [];
    const rankOf = (key: string) => {
      const i = order.indexOf(key);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    // Base index gives a stable fallback (groups, then disk/manual node order) for
    // anything not yet listed in `manualOrder` (e.g. a freshly created group).
    let base = 0;
    const units: { key: string; base: number; emit: () => void }[] = [];
    for (const g of groups) units.push({ key: groupKey(g.id), base: base++, emit: () => emitGroup(g) });
    for (const n of ordered) {
      if (n.kind === "Folder") {
        if (claimedBy.has(n.data.path)) continue; // grouped -> shown inside its group, not a top-level unit
        const data = n.data;
        units.push({ key: folderKey(data.name), base: base++, emit: () => emitFolder(data, 0, null) });
      } else {
        const data = n.data;
        units.push({ key: noteKey(data.id), base: base++, emit: () => emitNote(data) });
      }
    }
    units.sort((a, b) => {
      const r = rankOf(a.key) - rankOf(b.key);
      return r !== 0 ? r : a.base - b.base;
    });
    for (const u of units) u.emit();
    return rows;
  }

  // Field sort: groups first (stored order), then field-sorted ungrouped items.
  for (const g of groups) emitGroup(g);
  for (const n of ordered) {
    if (n.kind === "Folder") {
      if (!claimedBy.has(n.data.path)) emitFolder(n.data, 0, null);
    } else {
      emitNote(n.data);
    }
  }
  return rows;
}
