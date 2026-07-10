// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TreeNode } from "@/services";
import { NavTree } from "./NavTree";

function bigFlatTree(count: number): TreeNode[] {
  const nodes: TreeNode[] = [];
  for (let i = 0; i < count; i++) {
    nodes.push({
      kind: "Note",
      data: {
        id: `n${i}`,
        title: `Note ${i}`,
        path: `notes/n${i}.json`,
        modified: new Date().toISOString(),
        created: new Date().toISOString(),
        size: 100,
        icon: null,
      },
    } as TreeNode);
  }
  return nodes;
}

describe("NavTree virtualization", () => {
  beforeAll(() => {
    // jsdom has no real layout engine: offsetWidth/offsetHeight (what
    // @tanstack/react-virtual's initial measurement actually reads, per its
    // `getRect` helper) default to 0. Give the scroll container a realistic
    // viewport size so the test exercises real virtualization instead of an
    // empty visible range.
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      value: 260,
    });
  });

  it("mounts only the visible rows in the DOM for a ~10k-note vault, not all of them", () => {
    const tree = bigFlatTree(10_000);
    render(
      <NavTree
        tree={tree}
        vaultPath="/tmp/test-vault"
        openNoteId={null}
        expandedFolders={new Set()}
        onToggleFolder={() => {}}
        onSelectNote={() => {}}
        onOpenFolder={() => {}}
        onMoveNote={() => {}}
        onMoveFolder={() => {}}
        onRenameNote={() => {}}
        onRenameFolder={() => {}}
        onRequestDeleteNote={() => {}}
        onRequestDeleteFolder={() => {}}
        onSetNoteIcon={() => {}}
        onToggleNotePin={() => {}}
      />,
    );

    const mountedRows = screen.getAllByTestId("nav-row");
    expect(mountedRows.length).toBeGreaterThan(0);
    // ~600px viewport / ~28px rows + overscan: a couple dozen rows, nowhere
    // near the full 10,000 — this is the actual virtualization guarantee.
    expect(mountedRows.length).toBeLessThan(100);
  });
});
