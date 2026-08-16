// @vitest-environment jsdom
/**
 * Per-note scroll memory (useScrollMemory): leaving a note records where it was
 * scrolled, opening it again puts it back there.
 *
 * jsdom has no layout, so `scrollTop` is stubbed on the prototype with a
 * per-element value clamped to a test-controlled maximum — that clamp is the
 * behavior the hook has to cope with (a note whose images haven't settled yet
 * can't reach the remembered offset).
 */
import { useRef } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { useViewState } from "@/store/viewState";
import { useScrollMemory } from "./useScrollMemory";

/** How far the fake scroller can currently be scrolled — i.e. how tall its
 *  content has laid out so far. */
let maxScroll = 1000;
const offsets = new WeakMap<Element, number>();

beforeAll(() => {
  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    get(this: Element) {
      return offsets.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      const clamped = Math.max(0, Math.min(value, maxScroll));
      if (clamped === (offsets.get(this) ?? 0)) return;
      offsets.set(this, clamped);
      this.dispatchEvent(new Event("scroll"));
    },
  });
});

function Pane({ noteId }: { noteId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollMemory(ref, noteId);
  return <div data-testid="pane" ref={ref} />;
}

const pane = () => screen.getByTestId("pane");

/** Scroll the pane the way a user would — the hook listens for `scroll`. */
const scrollTo = (top: number) => act(() => void (pane().scrollTop = top));

/** Let one animation frame pass (the hook retries its restore per frame). */
const nextFrame = () =>
  act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

describe("useScrollMemory", () => {
  beforeEach(() => {
    maxScroll = 1000;
    useViewState.getState().noteScroll.clear();
  });
  afterEach(cleanup);

  it("puts a note back where it was left", async () => {
    const first = render(<Pane noteId="note-a" />);
    await scrollTo(420);
    first.unmount();

    render(<Pane noteId="note-a" />);
    expect(pane().scrollTop).toBe(420);
  });

  it("keeps a separate offset per note", async () => {
    const a = render(<Pane noteId="note-a" />);
    await scrollTo(420);
    a.unmount();

    const b = render(<Pane noteId="note-b" />);
    expect(pane().scrollTop).toBe(0); // never visited — starts at the title
    await scrollTo(90);
    b.unmount();

    render(<Pane noteId="note-a" />);
    expect(pane().scrollTop).toBe(420);
  });

  it("forgets a note scrolled back to the top", async () => {
    const first = render(<Pane noteId="note-a" />);
    await scrollTo(420);
    await scrollTo(0);
    first.unmount();

    expect(useViewState.getState().noteScroll.has("note-a")).toBe(false);
  });

  it("retries until the content is tall enough to reach the offset", async () => {
    const first = render(<Pane noteId="note-a" />);
    await scrollTo(420);
    first.unmount();

    // Remount with the note's images/banner not laid out yet: the offset is out
    // of reach, so the first attempt is clamped short.
    maxScroll = 100;
    render(<Pane noteId="note-a" />);
    expect(pane().scrollTop).toBe(100);

    maxScroll = 1000;
    await nextFrame();
    expect(pane().scrollTop).toBe(420);
  });

  it("stops restoring once the user scrolls", async () => {
    const first = render(<Pane noteId="note-a" />);
    await scrollTo(420);
    first.unmount();

    maxScroll = 100;
    render(<Pane noteId="note-a" />);
    fireEvent.wheel(pane());

    // Even once the content could reach 420, the user is driving now.
    maxScroll = 1000;
    await nextFrame();
    await nextFrame();
    expect(pane().scrollTop).toBe(100);
  });
});
