import { create } from "zustand";

/**
 * Live id→title map for note links (Phase 2 step 3). A note link stores the
 * target's UUID; its displayed label must be the target's *current* title, so a
 * rename updates every link automatically. This is a zustand store (not React
 * context) on purpose: BlockNote renders custom inline content in its own React
 * node-view roots, which app context doesn't reliably reach — an external store
 * (via `useSyncExternalStore`) does. Fed from the nav tree's summaries whenever
 * they refresh (App), read by each rendered link node.
 */
interface LinkTitlesState {
  titles: Record<string, string>;
  setTitles: (titles: Record<string, string>) => void;
}

export const useLinkTitles = create<LinkTitlesState>((set) => ({
  titles: {},
  setTitles: (titles) => set({ titles }),
}));

/** The target's current title, or `undefined` if it no longer resolves (deleted). */
export function useNoteTitle(id: string): string | undefined {
  return useLinkTitles((s) => s.titles[id]);
}
