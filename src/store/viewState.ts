import { create } from "zustand";

/**
 * The top-level view the shell is showing (Phase 2 step 4). The editor/nav are
 * the note-editing view; graph, quick notes, and home are peers switched via the
 * shell's view switcher. `quicknotes` and `home` are wired in steps 5–6.
 */
export type AppView =
  | "editor"
  | "graph"
  | "quicknotes"
  | "home"
  | "calendar"
  | "kanban"
  | "folder"
  | "template";

/**
 * UI view state ONLY (CLAUDE.md §8.5 / Phase 1 preamble: zustand holds view
 * state — open note id, expanded folders, current view — never note content).
 */
interface ViewState {
  /** Which top-level view is active in the shell. */
  view: AppView;
  setView: (view: AppView) => void;
  /** Open a note AND switch to the editor view — used by the graph's
   *  click-to-open and anything else that navigates to a note from another view. */
  openNote: (id: string) => void;

  openNoteId: string | null;
  setOpenNoteId: (id: string | null) => void;

  /** The folder whose table ("database") view is open, when `view === "folder"`
   *  (`""` = vault root). Set via {@link openFolder}. */
  folderViewPath: string | null;
  /** Open a folder's table view in the main pane and switch to it. */
  openFolder: (path: string) => void;

  /** The id of the template being edited in the main pane, when
   *  `view === "template"` (the Templates manager). Set via {@link openTemplate}. */
  templateEditId: string | null;
  /** Open a template in the editor (template mode) and switch to it. */
  openTemplate: (id: string) => void;

  expandedFolders: ReadonlySet<string>;
  toggleFolder: (path: string) => void;

  /** Whether the right-hand note-metadata inspector (backlinks, stats…) is open.
   *  UI-only preference; defaults closed so it never eats screen space unasked. */
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;
  toggleInspector: () => void;

  /** Whether the graph view's info/settings panel is open. Separate from the
   *  note inspector — the same key (Alt+I) toggles whichever fits the view. */
  graphInspectorOpen: boolean;
  setGraphInspectorOpen: (open: boolean) => void;
  toggleGraphInspector: () => void;

  /** A day to jump the full Calendar view to on its next mount (e.g. the
   *  Home dashboard's calendar widget navigating to a clicked day) — consumed
   *  once (CalendarView clears it right after reading it), so switching to
   *  Calendar any other way (the shell's view switcher) isn't affected by a
   *  stale target from an earlier click. */
  calendarTarget: Date | null;
  setCalendarTarget: (date: Date | null) => void;
  /** Set the target day and switch to the Calendar view in one step. */
  openCalendarOn: (date: Date) => void;

  /** Clear every reference to the PREVIOUS vault's notes/folders (open note,
   *  expanded folders, folder-table path, template-edit id, calendar target)
   *  and land back on Home — called when switching to a different vault, so
   *  none of those now-meaningless ids linger into the new one. */
  resetForVaultSwitch: () => void;
}

export const useViewState = create<ViewState>((set) => ({
  // Home is the landing view (Phase 2 step 6).
  view: "home",
  setView: (view) => set({ view }),
  openNote: (id) => set({ openNoteId: id, view: "editor" }),

  openNoteId: null,
  setOpenNoteId: (id) => set({ openNoteId: id }),

  folderViewPath: null,
  openFolder: (path) => set({ folderViewPath: path, view: "folder" }),

  templateEditId: null,
  openTemplate: (id) => set({ templateEditId: id, view: "template" }),

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

  inspectorOpen: false,
  setInspectorOpen: (open) => set({ inspectorOpen: open }),
  toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),

  graphInspectorOpen: false,
  setGraphInspectorOpen: (open) => set({ graphInspectorOpen: open }),
  toggleGraphInspector: () => set((state) => ({ graphInspectorOpen: !state.graphInspectorOpen })),

  calendarTarget: null,
  setCalendarTarget: (date) => set({ calendarTarget: date }),
  openCalendarOn: (date) => set({ calendarTarget: date, view: "calendar" }),

  resetForVaultSwitch: () =>
    set({
      view: "home",
      openNoteId: null,
      folderViewPath: null,
      templateEditId: null,
      expandedFolders: new Set(),
      calendarTarget: null,
    }),
}));
