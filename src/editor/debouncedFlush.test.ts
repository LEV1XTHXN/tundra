import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebouncedFlush } from "./debouncedFlush";

describe("createDebouncedFlush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces: does not flush while activity continues within the debounce window", () => {
    let flushCount = 0;
    const d = createDebouncedFlush(() => flushCount++, { debounceMs: 500, maxWaitMs: 5000 });

    d.schedule();
    vi.advanceTimersByTime(200);
    d.schedule();
    vi.advanceTimersByTime(200);
    d.schedule();
    expect(flushCount).toBe(0);

    // Now go idle past the debounce window: exactly one flush.
    vi.advanceTimersByTime(500);
    expect(flushCount).toBe(1);
  });

  it("the max-wait cap forces a flush under continuous activity, even though debounce alone never fires", () => {
    let flushCount = 0;
    const d = createDebouncedFlush(() => flushCount++, { debounceMs: 400, maxWaitMs: 2000 });

    // Simulate continuous typing: schedule() every 200ms (< debounceMs), for
    // longer than maxWaitMs. Debounce keeps getting reset and would never
    // fire on its own; only the max-wait cap can force a flush here.
    for (let i = 0; i < 15; i++) {
      d.schedule();
      vi.advanceTimersByTime(200);
    }

    expect(flushCount).toBeGreaterThanOrEqual(1);
  });

  it("isPending reflects whether a flush is currently scheduled", () => {
    const d = createDebouncedFlush(() => {}, { debounceMs: 500, maxWaitMs: 5000 });
    expect(d.isPending()).toBe(false);
    d.schedule();
    expect(d.isPending()).toBe(true);
    d.cancel();
    expect(d.isPending()).toBe(false);
  });
});
