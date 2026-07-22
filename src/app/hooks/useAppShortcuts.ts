import { Dispatch, SetStateAction, useEffect } from "react";
import { useKeybindings } from "@/store/keybindings";
import { useViewState } from "@/store/viewState";
import { matchCommand } from "@/keybindings/binding";

interface Params {
  onNewNote: () => void;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
}

/**
 * Global (app-level) keyboard shortcut dispatcher. Editor-scoped commands
 * (find-in-note, note links) are handled inside NoteEditor; both listeners share
 * the same `matchCommand` matcher and act only on their own command ids. The
 * inspector toggle is context-dependent — the note-metadata panel in the editor
 * (needs an open note) or the graph's info/settings panel in the graph view.
 */
export function useAppShortcuts({ onNewNote, setSearchOpen }: Params): void {
  const bindings = useKeybindings((s) => s.bindings);
  const view = useViewState((s) => s.view);
  const setView = useViewState((s) => s.setView);
  const openNoteId = useViewState((s) => s.openNoteId);
  const toggleInspector = useViewState((s) => s.toggleInspector);
  const toggleGraphInspector = useViewState((s) => s.toggleGraphInspector);
  const goBack = useViewState((s) => s.goBack);
  const goForward = useViewState((s) => s.goForward);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      switch (matchCommand(e, bindings)) {
        case "search.global":
          e.preventDefault();
          setSearchOpen((open) => !open);
          break;
        case "note.new":
          e.preventDefault();
          void onNewNote();
          break;
        case "view.quicknotes":
          e.preventDefault();
          setView("quicknotes");
          break;
        case "nav.back":
          e.preventDefault();
          goBack();
          break;
        case "nav.forward":
          e.preventDefault();
          goForward();
          break;
        case "inspector.toggle":
          if (view === "editor" && openNoteId) {
            e.preventDefault();
            toggleInspector();
          } else if (view === "graph") {
            e.preventDefault();
            toggleGraphInspector();
          }
          break;
      }
    }
    // Mouse back/forward (buttons 3/4), exactly like a web browser.
    function onMouseUp(e: MouseEvent) {
      if (e.button === 3) {
        e.preventDefault();
        goBack();
      } else if (e.button === 4) {
        e.preventDefault();
        goForward();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [
    bindings,
    onNewNote,
    setSearchOpen,
    setView,
    view,
    openNoteId,
    toggleInspector,
    toggleGraphInspector,
    goBack,
    goForward,
  ]);
}
