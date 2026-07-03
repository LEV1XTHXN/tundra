import type { NoteSummary } from "@/services";

/**
 * Candidates for the `[[` note-link menu (Phase 2 step 3): notes whose title
 * matches the query, excluding the current note (no self-links), capped for the
 * menu. Pure so it's unit-testable without standing up the editor.
 */
export function filterLinkCandidates(
  notes: NoteSummary[],
  currentNoteId: string,
  query: string,
  limit = 25,
): NoteSummary[] {
  const q = query.trim().toLowerCase();
  return notes
    .filter((n) => n.id !== currentNoteId && n.title.toLowerCase().includes(q))
    .slice(0, limit);
}
