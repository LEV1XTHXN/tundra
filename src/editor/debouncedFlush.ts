/**
 * Debounce a flush by `debounceMs` of inactivity, but force one at least every
 * `maxWaitMs` even under continuous activity (CLAUDE.md Phase 1 preamble:
 * "debounce ~400-800ms idle, with a max-wait cap ~2-3s so continuous typing
 * still flushes periodically"). Framework-agnostic so it's testable with fake
 * timers independent of BlockNote/React.
 */
export interface DebouncedFlushOptions {
  debounceMs: number;
  maxWaitMs: number;
}

export interface DebouncedFlush {
  /** Call on every change: (re)arms the debounce timer, and arms the max-wait timer if not already pending. */
  schedule: () => void;
  /** Cancel any pending timers without flushing. */
  cancel: () => void;
  /** Whether a flush is currently scheduled (debounce and/or max-wait pending). */
  isPending: () => boolean;
}

export function createDebouncedFlush(
  flush: () => void,
  { debounceMs, maxWaitMs }: DebouncedFlushOptions,
): DebouncedFlush {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let maxWaitTimer: ReturnType<typeof setTimeout> | undefined;

  function clear() {
    clearTimeout(debounceTimer);
    clearTimeout(maxWaitTimer);
    debounceTimer = undefined;
    maxWaitTimer = undefined;
  }

  function run() {
    clear();
    flush();
  }

  return {
    schedule() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(run, debounceMs);
      if (maxWaitTimer === undefined) {
        maxWaitTimer = setTimeout(run, maxWaitMs);
      }
    },
    cancel: clear,
    isPending: () => debounceTimer !== undefined || maxWaitTimer !== undefined,
  };
}
