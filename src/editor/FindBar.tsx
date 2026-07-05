/**
 * The find-in-note bar (opened by the `search.inNote` keybinding, default
 * Ctrl+F). Pinned to the top-right of the editor pane; drives the ProseMirror
 * find plugin (`findPlugin.ts`) that highlights matches and moves the selection.
 * React renders only — no data or FS access here.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { EditorView } from "prosemirror-view";
import { attachFindPlugin, focusMatch, getFindState, setSearch } from "./findPlugin";

interface FindBarProps {
  view: EditorView;
  onClose: () => void;
}

export function FindBar({ view, onClose }: FindBarProps) {
  const [query, setQuery] = useState("");
  const [total, setTotal] = useState(0);
  const [pos, setPos] = useState(0); // 0-based active match; meaningful when total > 0
  const inputRef = useRef<HTMLInputElement>(null);

  // Attach the highlight plugin while the bar is open; detaching clears it.
  useEffect(() => {
    const detach = attachFindPlugin(view);
    inputRef.current?.focus();
    return () => detach();
  }, [view]);

  // Re-run the search whenever the query changes, and jump to the first match.
  useEffect(() => {
    setSearch(view, query, 0);
    const { matches } = getFindState(view);
    setTotal(matches.length);
    setPos(0);
    if (matches.length > 0) focusMatch(view, 0);
  }, [view, query]);

  function go(delta: number) {
    const { matches, activeIndex } = getFindState(view);
    if (matches.length === 0) return;
    const next = activeIndex + delta;
    focusMatch(view, next);
    setPos(getFindState(view).activeIndex);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      go(e.shiftKey ? -1 : 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      go(-1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div className="find-bar" role="search">
      <input
        ref={inputRef}
        className="find-bar-input"
        placeholder="Find in note…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Find in note"
      />
      <span className="find-bar-count muted">
        {query ? `${total === 0 ? 0 : pos + 1} / ${total}` : ""}
      </span>
      <button
        className="find-bar-btn"
        onClick={() => go(-1)}
        disabled={total === 0}
        title="Previous match (Shift+Enter / ↑)"
        aria-label="Previous match"
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <button
        className="find-bar-btn"
        onClick={() => go(1)}
        disabled={total === 0}
        title="Next match (Enter / ↓)"
        aria-label="Next match"
      >
        <ChevronDown className="h-4 w-4" />
      </button>
      <button className="find-bar-btn" onClick={onClose} title="Close (Esc)" aria-label="Close find">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
