import { useEffect, useRef } from "react";

import type { SpellContext } from "./spellcheckPlugin";

/**
 * Shared behaviour for the editor's floating menus: close on Escape or an
 * outside mousedown. Returns the ref to attach to the menu's root element.
 */
function useDismissableMenu(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [onClose]);
  return ref;
}

/**
 * Context menu for a right-clicked misspelling (Phase 3 step 5): suggestions to
 * replace the word, and "Add to dictionary". Positioned at the click; closes on
 * Escape or an outside click. Keyboard-accessible (arrow/Tab through buttons).
 */
export function SpellcheckMenu({
  ctx,
  onReplace,
  onAddToDictionary,
  onClose,
}: {
  ctx: SpellContext;
  onReplace: (word: string) => void;
  onAddToDictionary: () => void;
  onClose: () => void;
}) {
  const ref = useDismissableMenu(onClose);
  // Focus the first item so the menu is immediately keyboard-drivable.
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);

  return (
    <div
      ref={ref}
      className="spell-menu"
      role="menu"
      aria-label={`Spelling suggestions for ${ctx.word}`}
      style={{ left: ctx.x, top: ctx.y }}
    >
      {ctx.suggestions.length === 0 ? (
        <div className="spell-menu-empty muted">No suggestions</div>
      ) : (
        ctx.suggestions.map((s) => (
          <button key={s} role="menuitem" className="spell-menu-item" onClick={() => onReplace(s)}>
            {s}
          </button>
        ))
      )}
      <div className="spell-menu-sep" />
      <button role="menuitem" className="spell-menu-item spell-menu-add" onClick={onAddToDictionary}>
        Add “{ctx.word}” to dictionary
      </button>
    </div>
  );
}

/**
 * The app-specific in-app context menu (replaces the system right-click
 * menu): positioned at the click, closes on Escape or an outside click —
 * same pattern as SpellcheckMenu above. Content is the formatting/block menu.
 */
export function EditorContextMenu({
  x,
  y,
  onClose,
  children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useDismissableMenu(onClose);
  return (
    <div ref={ref} className="editor-context-menu" style={{ left: x, top: y }}>
      {children}
    </div>
  );
}
