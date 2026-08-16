/**
 * Per-note scroll memory: leaving a note records how far it was scrolled, and
 * coming back restores it — so toggling between two notes doesn't throw you back
 * to the title of each one.
 *
 * The offset lives in `viewState` (session-only UI state, see the store's
 * `noteScroll` doc). The DOM work is here because restoring is not a single
 * assignment: `.editor-pane` is created with the note's content already in it,
 * but banners, images and file embeds settle their heights over the next few
 * frames, and a scroll offset the content can't reach yet is silently clamped.
 * So the target is re-applied until it sticks, until the content stops being too
 * short (SETTLE_MS), or until the user scrolls — whichever comes first. The user
 * always wins: any real input ends the restore immediately.
 *
 * React renders only — this touches the DOM and the view store, never files or
 * `@tauri-apps/api` (checked by `npm run check:layering`).
 */
import { useLayoutEffect, useRef } from "react";

import { useViewState } from "@/store/viewState";

/**
 * The key the quick-note scratchpad remembers its offset under. A constant, not
 * the document's id: `quickNote.read()` hands back a *fresh* note (new uuid)
 * until the scratchpad is first saved, so an id key would forget the offset on
 * an empty scratchpad. There's exactly one scratchpad, and note ids are uuids,
 * so it can't collide with a real note's key.
 */
export const QUICK_NOTE_SCROLL_KEY = "quicknote";

/** How long after mount the remembered offset is re-applied while the note's
 *  content settles. Long enough for a banner/image to decode, short enough that
 *  nothing yanks the page much later. */
const SETTLE_MS = 1500;

/** Sub-pixel scroll offsets are normal (zoom, fractional line heights) — treat
 *  anything inside a pixel as "we're there". */
const EPSILON = 1;

/** Input that means the user has taken over the scroller, so restoring must
 *  stop. `scroll` is deliberately absent: our own re-apply fires it. */
const USER_INPUT = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/**
 * Remember/restore the scroll offset of `scrollRef`'s element for `noteId`.
 *
 * Runs per mounted note: `NoteEditor` remounts the editor for every note
 * (keyed by id), so the effect's setup restores and its cleanup records.
 */
export function useScrollMemory(scrollRef: React.RefObject<HTMLElement | null>, noteId: string) {
  // The last offset seen while mounted. Kept in a ref rather than read off the
  // element at cleanup time: by then React may have detached the node, and a
  // detached element reports `scrollTop === 0`.
  const lastTop = useRef(0);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    const target = useViewState.getState().noteScroll.get(noteId) ?? 0;
    lastTop.current = 0;

    const onScroll = () => {
      lastTop.current = scroller.scrollTop;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });

    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopRestoring = () => {
      cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
      for (const type of USER_INPUT) scroller.removeEventListener(type, stopRestoring);
    };

    if (target > 0) {
      const tick = () => {
        // Assigning is clamped to what the content currently allows, so read
        // back the truth rather than assuming the target took.
        scroller.scrollTop = target;
        lastTop.current = scroller.scrollTop;
        if (Math.abs(scroller.scrollTop - target) < EPSILON) stopRestoring();
        else frame = requestAnimationFrame(tick);
      };
      for (const type of USER_INPUT) scroller.addEventListener(type, stopRestoring, { passive: true });
      timer = setTimeout(stopRestoring, SETTLE_MS);
      tick();
    }

    return () => {
      stopRestoring();
      scroller.removeEventListener("scroll", onScroll);
      useViewState.getState().rememberNoteScroll(noteId, lastTop.current);
    };
  }, [scrollRef, noteId]);
}
