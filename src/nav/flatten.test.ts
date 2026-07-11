import { describe, expect, it } from "vitest";
import type { TreeNode } from "@/services";
import type { FolderView } from "@/store/folderViews";
import { flattenTree, flattenWithGroups, folderOfNotePath, type NavGroup } from "./flatten";

function note(id: string, title: string, extra: Partial<{ modified: string; created: string; size: number }> = {}): TreeNode {
  return {
    kind: "Note",
    data: {
      id,
      title,
      path: `notes/${id}.json`,
      modified: extra.modified ?? "2026-01-01T00:00:00Z",
      created: extra.created ?? "2026-01-01T00:00:00Z",
      size: extra.size ?? 100,
      pinned: false,
      icon: null,
    },
  } as TreeNode;
}

function folder(name: string, path: string, children: TreeNode[]): TreeNode {
  return { kind: "Folder", data: { name, path, children } } as TreeNode;
}

/** No per-folder config: every folder is an empty view (defaults: manual sort). */
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
      { kind: "folder", path: "Biology", name: "Biology", icon: undefined, parent: "", depth: 0, expanded: false, hasChildren: true, groupId: null },
      { kind: "note", id: "n2", title: "Root Note", icon: null, parent: "", depth: 0 },
    ]);
  });

  it("expands a folder to reveal its children, at depth + 1", () => {
    const tree: TreeNode[] = [folder("Biology", "Biology", [note("n1", "Cell")])];

    const rows = flattenTree(tree, new Set(["Biology"]), noViews);
    expect(rows).toEqual([
      { kind: "folder", path: "Biology", name: "Biology", icon: undefined, parent: "", depth: 0, expanded: true, hasChildren: true, groupId: null },
      { kind: "note", id: "n1", title: "Cell", icon: null, parent: "Biology", depth: 1 },
    ]);
  });

  it("marks an empty folder as having no children", () => {
    const tree: TreeNode[] = [folder("Empty", "Empty", [])];
    const rows = flattenTree(tree, new Set(["Empty"]), noViews);
    expect(rows).toEqual([
      { kind: "folder", path: "Empty", name: "Empty", icon: undefined, parent: "", depth: 0, expanded: true, hasChildren: false, groupId: null },
    ]);
  });

  it("surfaces a folder's icon from its view", () => {
    const tree: TreeNode[] = [folder("Work", "Work", [])];
    const getView = views({ Work: { icon: { type: "emoji", value: "1f4bc" } } });
    const rows = flattenTree(tree, new Set(), getView);
    expect(rows[0]).toMatchObject({ kind: "folder", icon: { type: "emoji", value: "1f4bc" } });
  });

  it("falls back to 'Untitled' for a blank note title", () => {
    const tree: TreeNode[] = [note("n1", "")];
    const rows = flattenTree(tree, new Set(), noViews);
    expect(rows).toEqual([{ kind: "note", id: "n1", title: "Untitled", icon: null, parent: "", depth: 0 }]);
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

  it("honors manual order, dropping unlisted items to the bottom", () => {
    const rows = flattenTree(
      tree,
      new Set(),
      views({ "": { treeSort: { by: "manual", dir: "asc" }, manualOrder: ["note:nc", "note:na"] } }),
    );
    // nc, na listed (in that order); nb unlisted -> bottom.
    expect(titles(rows)).toEqual(["Cherry", "Apple", "Banana"]);
  });

  it("in a field sort, folders render above notes (by name)", () => {
    const t: TreeNode[] = [
      note("na", "Apple"),
      folder("Zebra", "Zebra", []),
      folder("Alpha", "Alpha", []),
    ];
    const getView = views({ "": { treeSort: { by: "name", dir: "asc" } } });
    const rows = flattenTree(t, new Set(), getView);
    expect(
      rows.map((r) => (r.kind === "folder" ? `F:${r.name}` : r.kind === "note" ? `N:${r.title}` : "")),
    ).toEqual(["F:Alpha", "F:Zebra", "N:Apple"]);
  });
});

describe("flattenWithGroups", () => {
  const label = (rows: ReturnType<typeof flattenWithGroups>) =>
    rows.map((r) =>
      r.kind === "group" ? `G:${r.name}(${r.folderCount})` : r.kind === "folder" ? `F:${r.name}@${r.depth}` : `N:${r.title}`,
    );

  it("lays out groups first (folders nested under headers), then ungrouped items", () => {
    const tree: TreeNode[] = [
      folder("Projects", "Projects", []),
      folder("Meetings", "Meetings", []),
      folder("Inbox", "Inbox", []),
      note("n1", "loose"),
    ];
    const groups: NavGroup[] = [{ id: "g1", name: "Work", folders: ["Projects", "Meetings"] }];
    const rows = flattenWithGroups(tree, groups, new Set(), noViews);
    expect(label(rows)).toEqual([
      "G:Work(2)",
      "F:Projects@1",
      "F:Meetings@1",
      "F:Inbox@0", // ungrouped folder at root depth
      "N:loose",
    ]);
    // The grouped folder carries its group id (for drag/unassign).
    const projects = rows.find((r) => r.kind === "folder" && r.name === "Projects");
    expect(projects).toMatchObject({ groupId: "g1" });
  });

  it("hides a collapsed group's folders but still shows the header", () => {
    const tree: TreeNode[] = [folder("Projects", "Projects", []), folder("Inbox", "Inbox", [])];
    const groups: NavGroup[] = [{ id: "g1", name: "Work", folders: ["Projects"], collapsed: true }];
    const rows = flattenWithGroups(tree, groups, new Set(), noViews);
    expect(label(rows)).toEqual(["G:Work(1)", "F:Inbox@0"]);
  });

  it("skips a group folder that no longer exists on disk (count reflects only real folders)", () => {
    const tree: TreeNode[] = [folder("Projects", "Projects", [])];
    const groups: NavGroup[] = [{ id: "g1", name: "Work", folders: ["Projects", "Gone"] }];
    const rows = flattenWithGroups(tree, groups, new Set(), noViews);
    expect(label(rows)).toEqual(["G:Work(1)", "F:Projects@1"]);
  });

  it("a folder claimed by two groups shows only under the first", () => {
    const tree: TreeNode[] = [folder("Shared", "Shared", [])];
    const groups: NavGroup[] = [
      { id: "g1", name: "A", folders: ["Shared"] },
      { id: "g2", name: "B", folders: ["Shared"] },
    ];
    const rows = flattenWithGroups(tree, groups, new Set(), noViews);
    expect(label(rows)).toEqual(["G:A(1)", "F:Shared@1", "G:B(0)"]);
  });
});

describe("folderOfNotePath", () => {
  it("derives the containing folder from a vault-relative note path", () => {
    expect(folderOfNotePath("notes/Biology/Plants/fern.json")).toBe("Biology/Plants");
    expect(folderOfNotePath("notes/cell.json")).toBe("");
  });
});
