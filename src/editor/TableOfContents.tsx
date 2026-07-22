/**
 * The note's table-of-contents overlay (a Notion-style minimap pinned to the
 * right edge of the editor): a column of stripes whose width encodes each
 * heading's level, and — on hover — a floating panel of clickable heading
 * titles. Clicking a title scrolls the note to that heading; the stripe/row for
 * the currently-visible section is emphasized.
 *
 * React renders only: it reads headings from the live `editor.document` (never
 * files or the core) and scrolls the editor pane by measuring the DOM. It never
 * imports `@tauri-apps/api` (checked by `npm run check:layering`).
 */
import { useCallback, useEffect, useState } from "react";
import { useEditorChange } from "@blocknote/react";

import { useViewState } from "@/store/viewState";
import type { NoteBlockEditor } from "./useNoteBlockEditor";
import { extractHeadings, type TocHeading } from "./tocHeadings";

/** Below this many headings the TOC is more clutter than help, so it's hidden. */
const MIN_HEADINGS = 2;
/** Gap left above a clicked/active heading so it lands just under the pane top
 *  (not flush against it) — matches the note's own top padding feel. */
const SCROLL_OFFSET = 24;

interface Props {
  editor: NoteBlockEditor;
  /** The `.editor-pane` scroll container (also the DOM we query for headings). */
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

/** The heading DOM node inside the scroller, matched by its BlockNote `data-id`. */
function headingEl(scroller: HTMLElement, id: string): HTMLElement | null {
  return scroller.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
}

export function TableOfContents({ editor, scrollRef }: Props) {
  const [headings, setHeadings] = useState<TocHeading[]>(() => extractHeadings(editor.document));
  const [activeId, setActiveId] = useState<string | null>(null);
  // The inspector drawer occupies the same right edge (Notion's TOC-vs-sidebar
  // model), so only one shows at a time.
  const inspectorOpen = useViewState((s) => s.inspectorOpen);

  // Recompute the outline live as the note is edited.
  useEditorChange(() => setHeadings(extractHeadings(editor.document)), editor);

  // Track which heading is the current section: the last one whose top has
  // scrolled to/above a small offset below the pane top. rAF-throttled so a
  // fast scroll doesn't measure on every event.
  const recomputeActive = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller || headings.length === 0) return;
    const top = scroller.getBoundingClientRect().top + SCROLL_OFFSET + 1;
    let current: string | null = headings[0]?.id ?? null;
    for (const h of headings) {
      const el = headingEl(scroller, h.id);
      if (el && el.getBoundingClientRect().top <= top) current = h.id;
    }
    setActiveId(current);
  }, [headings, scrollRef]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(recomputeActive);
    };
    recomputeActive(); // initial highlight
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [recomputeActive, scrollRef]);

  const scrollTo = useCallback(
    (id: string) => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      const el = headingEl(scroller, id);
      if (!el) return;
      // Measured offset within the scroller (ProseMirror's native scrollIntoView
      // is unreliable under WebKitGTK — see findPlugin.ts).
      const delta = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTo({ top: scroller.scrollTop + delta - SCROLL_OFFSET, behavior: "smooth" });
      setActiveId(id);
    },
    [scrollRef],
  );

  if (inspectorOpen || headings.length < MIN_HEADINGS) return null;

  return (
    <nav className="toc" aria-label="Table of contents">
      <div className="toc-stripes" aria-hidden="true">
        {headings.map((h, i) => (
          <span
            key={`${h.id}-${i}`}
            className={`toc-stripe toc-stripe-l${Math.min(h.level, 3)}${h.id === activeId ? " is-active" : ""}`}
          />
        ))}
      </div>
      <ul className="toc-panel">
        {headings.map((h, i) => (
          <li key={`${h.id}-${i}`}>
            <button
              type="button"
              className={`toc-item toc-item-l${Math.min(h.level, 3)}${h.id === activeId ? " is-active" : ""}`}
              title={h.text}
              onClick={(e) => {
                scrollTo(h.id);
                // Release focus so the panel collapses on mouse-out — otherwise
                // `:focus-within` keeps it open until you click elsewhere. Keyboard
                // users still get the hover/focus reveal while tabbing through.
                e.currentTarget.blur();
              }}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
