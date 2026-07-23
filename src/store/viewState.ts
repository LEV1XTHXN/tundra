import { create } from "zustand";

/**
 * The top-level view the shell is showing (Phase 2 step 4). The editor/nav are
 * the note-editing view; graph, quick notes, and home are peers switched via the
 * shell's icon ribbon. `quicknotes` and `home` are wired in steps 5–6.
 *
 * `templates` is the template *manager* (a list of every template); `template`
 * — singular — is the editor open on ONE template, keyed by `templateEditId`.
 */
export type AppView =
  | "editor"
  | "graph"
  | "quicknotes"
  | "home"
  | "calendar"
  | "kanban"
  | "folder"
  | "tags"
  | "templates"
  | "template";

/**
 * A single entry in the browser-style navigation history — the composite
 * "location" the back/forward buttons restore. Everything the shell needs to
 * re-render a past destination (which view + its target id). The calendar's
 * per-day jump target is deliberately excluded: restoring `view: "calendar"` is
 * enough, and `calendarTarget` is a consume-once value, not part of a location.
 */
export interface NavLocation {
  view: AppView;
  openNoteId: string | null;
  folderViewPath: string | null;
  templateEditId: string | null;
}

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

  /** Browser-style navigation history: every visited location, oldest first.
   *  `navIndex` is the cursor into it (the currently-shown location). Back moves
   *  the cursor left, Forward right; navigating to a new place after going back
   *  truncates everything ahead of the cursor (exactly like a web browser). Held
   *  in memory only and reset on vault switch. */
  navHistory: NavLocation[];
  navIndex: number;
  /** Step back one entry in the history (no-op at the start). */
  goBack: () => void;
  /** Step forward one entry in the history (no-op at the end). */
  goForward: () => void;

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

/** The location the app lands on at boot / after a vault switch. */
const HOME_LOCATION: NavLocation = {
  view: "home",
  openNoteId: null,
  folderViewPath: null,
  templateEditId: null,
};

/** Two locations are the "same place" when every field matches — used to skip
 *  recording a no-op navigation (e.g. re-clicking the already-open note). */
function sameLocation(a: NavLocation, b: NavLocation): boolean {
  return (
    a.view === b.view &&
    a.openNoteId === b.openNoteId &&
    a.folderViewPath === b.folderViewPath &&
    a.templateEditId === b.templateEditId
  );
}

export const useViewState = create<ViewState>((set, get) => {
  /**
   * Central navigation choke point: apply `patch` (merged onto the current
   * location) as the new visible location AND record it in the history, dropping
   * any forward entries — the behavior every `openX`/`setView` action shares.
   * Consecutive duplicates are applied but not pushed, so the back stack never
   * fills with repeats.
   */
  const recordNav = (patch: Partial<NavLocation>) => {
    const state = get();
    const current: NavLocation = {
      view: state.view,
      openNoteId: state.openNoteId,
      folderViewPath: state.folderViewPath,
      templateEditId: state.templateEditId,
    };
    const next: NavLocation = { ...current, ...patch };
    set(next);
    if (sameLocation(next, state.navHistory[state.navIndex] ?? current)) return;
    const history = state.navHistory.slice(0, state.navIndex + 1);
    history.push(next);
    set({ navHistory: history, navIndex: history.length - 1 });
  };

  return {
  // Home is the landing view (Phase 2 step 6).
  view: "home",
  setView: (view) => recordNav({ view }),
  openNote: (id) => recordNav({ view: "editor", openNoteId: id }),

  openNoteId: null,
  setOpenNoteId: (id) => set({ openNoteId: id }),

  folderViewPath: null,
  openFolder: (path) => recordNav({ view: "folder", folderViewPath: path }),

  templateEditId: null,
  openTemplate: (id) => recordNav({ view: "template", templateEditId: id }),

  navHistory: [HOME_LOCATION],
  navIndex: 0,
  goBack: () => {
    const { navIndex, navHistory } = get();
    if (navIndex <= 0) return;
    const target = navHistory[navIndex - 1];
    set({ ...target, navIndex: navIndex - 1 });
  },
  goForward: () => {
    const { navIndex, navHistory } = get();
    if (navIndex >= navHistory.length - 1) return;
    const target = navHistory[navIndex + 1];
    set({ ...target, navIndex: navIndex + 1 });
  },

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
  openCalendarOn: (date) => {
    set({ calendarTarget: date });
    recordNav({ view: "calendar" });
  },

  resetForVaultSwitch: () =>
    set({
      ...HOME_LOCATION,
      expandedFolders: new Set(),
      calendarTarget: null,
      // Wipe the history — the previous vault's notes/folders are meaningless
      // here, so back/forward must start fresh at Home.
      navHistory: [HOME_LOCATION],
      navIndex: 0,
    }),
  };
});
