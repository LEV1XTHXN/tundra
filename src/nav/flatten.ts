import type { Icon, TreeNode } from "@/services";

/**
 * One visible row in the nav tree — a folder header or a note. Produced by
 * flattening only the *expanded* parts of the tree, so the row list stays
 * proportional to what's actually visible, not the whole vault (this is what
 * `@tanstack/react-virtual` virtualizes: CLAUDE.md Phase 1 preamble's ~50k-note
 * scale target).
 */
export type NavRow =
  | { kind: "folder"; path: string; name: string; depth: number; expanded: boolean; hasChildren: boolean }
  | { kind: "note"; id: string; title: string; icon: Icon | null | undefined; depth: number };

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

/** Flatten the folder/note tree into a linear row list, respecting which folders are expanded. */
export function flattenTree(nodes: TreeNode[], expandedFolders: ReadonlySet<string>, depth = 0): NavRow[] {
  const rows: NavRow[] = [];
  for (const node of nodes) {
    if (node.kind === "Folder") {
      const folder = node.data;
      const isExpanded = expandedFolders.has(folder.path);
      rows.push({
        kind: "folder",
        path: folder.path,
        name: folder.name,
        depth,
        expanded: isExpanded,
        hasChildren: folder.children.length > 0,
      });
      if (isExpanded) {
        rows.push(...flattenTree(folder.children, expandedFolders, depth + 1));
      }
    } else {
      const note = node.data;
      rows.push({ kind: "note", id: note.id, title: note.title || "Untitled", icon: note.icon, depth });
    }
  }
  return rows;
}
