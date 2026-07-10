import { describe, expect, it } from "vitest";
import type { TreeNode } from "@/services";
import type { FolderView } from "@/store/folderViews";
import { flattenTree, folderOfNotePath } from "./flatten";

function note(id: string, title: string, extra: Partial<{ modified: string; created: string; size: number; pinned: boolean }> = {}): TreeNode {
  return {
    kind: "Note",
    data: {
      id,
      title,
      path: `notes/${id}.json`,
      modified: extra.modified ?? "2026-01-01T00:00:00Z",
      created: extra.created ?? "2026-01-01T00:00:00Z",
      size: extra.size ?? 100,
      pinned: extra.pinned ?? false,
      icon: null,
    },
  } as TreeNode;
}

function folder(name: string, path: string, children: TreeNode[]): TreeNode {
  return { kind: "Folder", data: { name, path, children } } as TreeNode;
}

/** No per-folder config: every folder is an empty view (defaults: manual sort, unpinned). */
const noViews = () => ({}) as FolderView;
/** Build a `getView` from a path→view map. */
const views = (map: Record<string, FolderView>) => (path: string) => map[path] ?? {};

describe("flattenTree", () => {
  it("renders nested folders correctly: collapsed folders hide their children", () => {
    const tree: TreeNode[] = [
      folder("Biology", "Biology", [note("n1", "Cell")]),
      note("n2", "Root Note"),
    ];

    const rows = flattenTree(tree, new Set(), noViews); // nothing expanded
    expect(rows).toEqual([
      { kind: "folder", path: "Biology", name: "Biology", parent: "", depth: 0, expanded: false, hasChildren: true, pinned: false },
      { kind: "note", id: "n2", title: "Root Note", icon: null, parent: "", depth: 0, pinned: false },
    ]);
  });

  it("expands a folder to reveal its children, at depth + 1", () => {
    const tree: TreeNode[] = [folder("Biology", "Biology", [note("n1", "Cell")])];

    const rows = flattenTree(tree, new Set(["Biology"]), noViews);
    expect(rows).toEqual([
      { kind: "folder", path: "Biology", name: "Biology", parent: "", depth: 0, expanded: true, hasChildren: true, pinned: false },
      { kind: "note", id: "n1", title: "Cell", icon: null, parent: "Biology", depth: 1, pinned: false },
    ]);
  });

  it("marks an empty folder as having no children", () => {
    const tree: TreeNode[] = [folder("Empty", "Empty", [])];
    const rows = flattenTree(tree, new Set(["Empty"]), noViews);
    expect(rows).toEqual([
      { kind: "folder", path: "Empty", name: "Empty", parent: "", depth: 0, expanded: true, hasChildren: false, pinned: false },
    ]);
  });

  it("falls back to 'Untitled' for a blank note title", () => {
    const tree: TreeNode[] = [note("n1", "")];
    const rows = flattenTree(tree, new Set(), noViews);
    expect(rows).toEqual([{ kind: "note", id: "n1", title: "Untitled", icon: null, parent: "", depth: 0, pinned: false }]);
  });

  it("produces one row per node when fully collapsed, regardless of how deep the tree is", () => {
    const deep: TreeNode[] = [
      folder("a", "a", [folder("b", "a/b", [folder("c", "a/b/c", [note("n1", "Deep")])])]),
    ];
    expect(flattenTree(deep, new Set(), noViews)).toHaveLength(1);
  });
});

describe("flattenTree ordering", () => {
  const tree: TreeNode[] = [
    note("nb", "Banana", { modified: "2026-03-01T00:00:00Z", size: 300 }),
    note("na", "Apple", { modified: "2026-01-01T00:00:00Z", size: 100 }),
    note("nc", "Cherry", { modified: "2026-02-01T00:00:00Z", size: 200 }),
  ];

  const titles = (rows: ReturnType<typeof flattenTree>) =>
    rows.filter((r) => r.kind === "note").map((r) => (r.kind === "note" ? r.title : ""));

  it("sorts notes by name ascending", () => {
    const rows = flattenTree(tree, new Set(), views({ "": { treeSort: { by: "name", dir: "asc" } } }));
    expect(titles(rows)).toEqual(["Apple", "Banana", "Cherry"]);
  });

  it("sorts notes by name descending", () => {
    const rows = flattenTree(tree, new Set(), views({ "": { treeSort: { by: "name", dir: "desc" } } }));
    expect(titles(rows)).toEqual(["Cherry", "Banana", "Apple"]);
  });

  it("sorts notes by modified date ascending", () => {
    const rows = flattenTree(tree, new Set(), views({ "": { treeSort: { by: "modified", dir: "asc" } } }));
    expect(titles(rows)).toEqual(["Apple", "Cherry", "Banana"]);
  });

  it("sorts notes by size descending", () => {
    const rows = flattenTree(tree, new Set(), views({ "": { treeSort: { by: "size", dir: "desc" } } }));
    expect(titles(rows)).toEqual(["Banana", "Cherry", "Apple"]);
  });

  it("floats pinned notes to the top, keeping the sort within each group", () => {
    const t: TreeNode[] = [
      note("nb", "Banana"),
      note("na", "Apple", { pinned: true }),
      note("nc", "Cherry"),
    ];
    const rows = flattenTree(t, new Set(), views({ "": { treeSort: { by: "name", dir: "asc" } } }));
    expect(titles(rows)).toEqual(["Apple", "Banana", "Cherry"]); // Apple pinned + already first
    const t2: TreeNode[] = [
      note("nb", "Banana"),
      note("nc", "Cherry", { pinned: true }),
      note("na", "Apple"),
    ];
    const rows2 = flattenTree(t2, new Set(), views({ "": { treeSort: { by: "name", dir: "asc" } } }));
    expect(titles(rows2)).toEqual(["Cherry", "Apple", "Banana"]); // Cherry pinned floats above A/B
  });

  it("honors manual order, dropping unlisted items to the bottom", () => {
    const rows = flattenTree(
      tree,
      new Set(),
      views({ "": { treeSort: { by: "manual", dir: "asc" }, manualOrder: ["note:nc", "note:na"] } }),
    );
    // nc, na listed (in that order); nb unlisted -> bottom.
    expect(titles(rows)).toEqual(["Cherry", "Apple", "Banana"]);
  });

  it("in a field sort, folders render above notes; a pinned folder floats up", () => {
    const t: TreeNode[] = [
      note("na", "Apple"),
      folder("Zebra", "Zebra", []),
      folder("Alpha", "Alpha", []),
    ];
    const getView = views({ "": { treeSort: { by: "name", dir: "asc" } }, Zebra: { pinned: true } });
    const rows = flattenTree(t, new Set(), getView);
    expect(rows.map((r) => (r.kind === "folder" ? `F:${r.name}` : `N:${r.title}`))).toEqual([
      "F:Zebra", // pinned folder first
      "F:Alpha", // then remaining folders by name
      "N:Apple", // notes after folders
    ]);
  });
});

describe("folderOfNotePath", () => {
  it("derives the containing folder from a vault-relative note path", () => {
    expect(folderOfNotePath("notes/Biology/Plants/fern.json")).toBe("Biology/Plants");
    expect(folderOfNotePath("notes/cell.json")).toBe("");
  });
});
