// Native (webview) context-menu suppression.
//
// The webview's own right-click menu is a browser menu, not an app menu: it
// offers Reload, Back/Forward, "Open Link in New Window" — actions that make no
// sense in a note app and one that is actively destructive (a reload restarts
// the frontend under a Rust process that never restarted). It appeared on every
// surface that doesn't already open a menu of its own: the editor pane's padding,
// the note title input, the banner, the ribbon, home, graph, dialogs, and the
// onboarding screen.
//
// Fix: one listener on `window` that cancels the default menu everywhere. The
// app's own context menus are unaffected — they run first and open exactly as
// before (nav tree, calendar, tags, templates, the `.bn-editor` body's format
// menu, and the misspelled-word suggestions menu).
//
// BUBBLE phase, deliberately, not capture: `useEditorContextMenus` branches on
// `event.defaultPrevented` to let a right-clicked misspelling's menu take
// priority over the format menu, so the flag must not already be set when the
// editor's handlers run. Cancelling the default at the end of propagation
// suppresses the menu just as well — the default action happens after.
//
// The one constraint this creates: a `contextmenu` handler that calls
// `stopPropagation()` must also call `preventDefault()`, since the event never
// reaches this listener. Both current ones (NavTree, CalendarContextMenu) sit
// inside Radix `ContextMenuTrigger`s, which preventDefault when they open.
//
// Installed at startup from `main.tsx`, in every build — dev included, so what
// you right-click in `tauri dev` is what ships. In dev only, SHIFT+right-click
// still opens the native menu (the same escape hatch Firefox uses), which is how
// you reach "Inspect Element"; in release builds nothing bypasses it.

/** Installs the suppressor; returns a function that removes it again. */
export function installContextMenuSuppressor(): () => void {
  function onContextMenu(event: MouseEvent) {
    if (import.meta.env.DEV && event.shiftKey) return;
    event.preventDefault();
  }
  window.addEventListener("contextmenu", onContextMenu);
  return () => window.removeEventListener("contextmenu", onContextMenu);
}
