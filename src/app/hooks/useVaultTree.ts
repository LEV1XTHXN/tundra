import { useCallback, useEffect, useState } from "react";
import { notes, tree as fetchTree, watcher } from "@/services";
import type { NoteSummary, TreeNode } from "@/services";
import { useLinkTitles } from "@/store/linkTitles";

export interface VaultTree {
  treeData: TreeNode[];
  noteSummaries: Map<string, NoteSummary>;
  /** Re-fetch the folder tree + note summaries; returns the fresh summary list. */
  refreshTree: () => Promise<NoteSummary[]>;
}

/**
 * The nav tree + note-summary map, and the single `refreshTree` that both the
 * shell and every mutation call after a change. Depends only on `services`, so
 * it stays independent of vault-session lifecycle (the session injects this
 * `refreshTree` and calls it after opening a vault).
 */
export function useVaultTree(): VaultTree {
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [noteSummaries, setNoteSummaries] = useState<Map<string, NoteSummary>>(new Map());

  const refreshTree = useCallback(async () => {
    const [t, list] = await Promise.all([fetchTree(), notes.list()]);
    setTreeData(t);
    setNoteSummaries(new Map(list.map((n) => [n.id, n])));
    return list;
  }, []);

  // Phase 1 step 8: the Rust file watcher emits this when the tree changed on
  // disk for a reason other than our own writes (self-writes are filtered
  // before it ever reaches here) — refresh the nav tree to match.
  useEffect(() => watcher.onTreeChanged(() => void refreshTree()), [refreshTree]);

  // Phase 2 step 3: keep the live id→title map current so note links always
  // render the target's CURRENT title (a rename updates every link's label).
  useEffect(() => {
    const titles: Record<string, string> = {};
    noteSummaries.forEach((s, id) => {
      titles[id] = s.title;
    });
    useLinkTitles.getState().setTitles(titles);
  }, [noteSummaries]);

  return { treeData, noteSummaries, refreshTree };
}
