import { create } from "zustand";

/**
 * UI view state ONLY (CLAUDE.md §8.5 / Phase 1 preamble: zustand holds view
 * state — open note id, expanded folders, theme — never note content).
 */
interface ViewState {
  openNoteId: string | null;
  setOpenNoteId: (id: string | null) => void;

  expandedFolders: ReadonlySet<string>;
  toggleFolder: (path: string) => void;
}

export const useViewState = create<ViewState>((set) => ({
  openNoteId: null,
  setOpenNoteId: (id) => set({ openNoteId: id }),

  expandedFolders: new Set(),
  toggleFolder: (path) =>
    set((state) => {
      const next = new Set(state.expandedFolders);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return { expandedFolders: next };
    }),
}));
