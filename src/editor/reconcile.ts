/**
 * The Phase 1 preamble's external-change reconciliation policy, as a pure
 * decision function — separated from NoteEditor's BlockNote/React state so
 * it's directly testable without needing to race the debounce timer by hand.
 *
 * - File deleted while open -> keep the buffer, offer "recreate" (regardless
 *   of dirty state — there's nothing to silently reload from).
 * - File still exists, editor dirty -> never auto-overwrite; banner.
 * - File still exists, editor clean -> reload silently (the caller does the
 *   reload; this returns "none" to signal that).
 */
export type ReconcileDecision = { kind: "none" } | { kind: "dirty-conflict" } | { kind: "deleted" };

export function decideReconciliation(params: { stillExists: boolean; isDirty: boolean }): ReconcileDecision {
  if (!params.stillExists) return { kind: "deleted" };
  if (params.isDirty) return { kind: "dirty-conflict" };
  return { kind: "none" };
}
