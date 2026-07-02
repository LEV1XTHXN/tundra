import { describe, expect, it } from "vitest";
import type { TreeNode } from "@/services";
import { flattenTree, folderOfNotePath } from "./flatten";

function note(id: string, title: string): TreeNode {
  return {
    kind: "Note",
    data: { id, title, path: `notes/${id}.json`, modified: new Date().toISOString(), icon: null },
  } as TreeNode;
}

function folder(name: string, path: string, children: TreeNode[]): TreeNode {
  return { kind: "Folder", data: { name, path, children } } as TreeNode;
}

describe("flattenTree", () => {
  it("renders nested folders correctly: collapsed folders hide their children", () => {
    const tree: TreeNode[] = [
      folder("Biology", "Biology", [note("n1", "Cell")]),
      note("n2", "Root Note"),
    ];

    const rows = flattenTree(tree, new Set()); // nothing expanded
    expect(rows).toEqual([
      { kind: "folder", path: "Biology", name: "Biology", depth: 0, expanded: false, hasChildren: true },
      { kind: "note", id: "n2", title: "Root Note", icon: null, depth: 0 },
    ]);
  });

  it("expands a folder to reveal its children, at depth + 1", () => {
    const tree: TreeNode[] = [folder("Biology", "Biology", [note("n1", "Cell")])];

    const rows = flattenTree(tree, new Set(["Biology"]));
    expect(rows).toEqual([
      { kind: "folder", path: "Biology", name: "Biology", depth: 0, expanded: true, hasChildren: true },
      { kind: "note", id: "n1", title: "Cell", icon: null, depth: 1 },
    ]);
  });

  it("marks an empty folder as having no children", () => {
    const tree: TreeNode[] = [folder("Empty", "Empty", [])];
    const rows = flattenTree(tree, new Set(["Empty"]));
    expect(rows).toEqual([
      { kind: "folder", path: "Empty", name: "Empty", depth: 0, expanded: true, hasChildren: false },
    ]);
  });

  it("only expands nested folders whose own path is in the expanded set", () => {
    const tree: TreeNode[] = [
      folder("Biology", "Biology", [
        folder("Plants", "Biology/Plants", [note("n1", "Fern")]),
      ]),
    ];

    // Only the outer folder expanded: inner folder shows as a row, but collapsed.
    const rows = flattenTree(tree, new Set(["Biology"]));
    expect(rows).toEqual([
      { kind: "folder", path: "Biology", name: "Biology", depth: 0, expanded: true, hasChildren: true },
      { kind: "folder", path: "Biology/Plants", name: "Plants", depth: 1, expanded: false, hasChildren: true },
    ]);

    // Both expanded: the note appears at depth 2.
    const rowsBoth = flattenTree(tree, new Set(["Biology", "Biology/Plants"]));
    expect(rowsBoth).toEqual([
      { kind: "folder", path: "Biology", name: "Biology", depth: 0, expanded: true, hasChildren: true },
      { kind: "folder", path: "Biology/Plants", name: "Plants", depth: 1, expanded: true, hasChildren: true },
      { kind: "note", id: "n1", title: "Fern", icon: null, depth: 2 },
    ]);
  });

  it("falls back to 'Untitled' for a blank note title", () => {
    const tree: TreeNode[] = [note("n1", "")];
    const rows = flattenTree(tree, new Set());
    expect(rows).toEqual([{ kind: "note", id: "n1", title: "Untitled", icon: null, depth: 0 }]);
  });

  it("produces one row per node when fully collapsed, regardless of how deep the tree is", () => {
    const deep: TreeNode[] = [
      folder("a", "a", [folder("b", "a/b", [folder("c", "a/b/c", [note("n1", "Deep")])])]),
    ];
    // Nothing expanded: only the top-level folder row shows.
    expect(flattenTree(deep, new Set())).toHaveLength(1);
  });
});

describe("folderOfNotePath", () => {
  it("derives the containing folder from a vault-relative note path", () => {
    expect(folderOfNotePath("notes/Biology/Plants/fern.json")).toBe("Biology/Plants");
    expect(folderOfNotePath("notes/cell.json")).toBe("");
  });
});
