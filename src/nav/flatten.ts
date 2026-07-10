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
      kind: "folder";
      path: string;
      name: string;
      /** Containing folder path (`""` = root) — used for drag-reordering among siblings. */
      parent: string;
      depth: number;
      expanded: boolean;
      hasChildren: boolean;
      pinned: boolean;
    }
  | {
      kind: "note";
      id: string;
      title: string;
      icon: Icon | null | undefined;
      /** Containing folder path (`""` = root) — used for drag-reordering among siblings. */
      parent: string;
      depth: number;
      pinned: boolean;
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

/** Is a child node pinned? Notes carry `pinned` in their summary; folders in their view. */
function isPinned(node: TreeNode, getView: (path: string) => FolderView): boolean {
  return node.kind === "Folder"
    ? getView(node.data.path).pinned === true
    : node.data.pinned === true;
}

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
 * user): pinned items always float to the top; then, for a field sort, folders
 * render above notes (folders by name, notes by the chosen field); for a manual
 * sort, folders and notes interleave in the user's drag order, with anything
 * unlisted falling to the bottom in a stable order.
 */
const orderChildren: Ordering = (nodes, view, getView) => {
  const sort = view.treeSort ?? { by: "manual", dir: "asc" };
  const factor = dirFactor(sort.dir);

  // Stable base index so equal keys keep their incoming (disk-walk) order.
  const indexed = nodes.map((node, i) => ({ node, i }));

  const pinRank = (n: TreeNode) => (isPinned(n, getView) ? 0 : 1);

  if (sort.by === "manual") {
    const order = view.manualOrder ?? [];
    const keyOf = (n: TreeNode) => (n.kind === "Folder" ? folderKey(n.data.name) : noteKey(n.data.id));
    const rankOf = (n: TreeNode) => {
      const idx = order.indexOf(keyOf(n));
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    };
    indexed.sort((x, y) => {
      const p = pinRank(x.node) - pinRank(y.node);
      if (p !== 0) return p;
      const r = rankOf(x.node) - rankOf(y.node);
      return r !== 0 ? r : x.i - y.i;
    });
    return indexed.map((e) => e.node);
  }

  // Field sort: pinned first, then folders-before-notes, then the field.
  indexed.sort((x, y) => {
    const p = pinRank(x.node) - pinRank(y.node);
    if (p !== 0) return p;
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

/**
 * Flatten the folder/note tree into a linear row list, respecting which folders
 * are expanded and each folder's own sort/manual/pin order (from `getView`).
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
      rows.push({
        kind: "folder",
        path: folder.path,
        name: folder.name,
        parent: parentPath,
        depth,
        expanded: isExpanded,
        hasChildren: folder.children.length > 0,
        pinned: getView(folder.path).pinned === true,
      });
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
        pinned: note.pinned === true,
      });
    }
  }
  return rows;
}
