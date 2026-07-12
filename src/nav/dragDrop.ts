/**
 * Native HTML5 drag-and-drop payload + drop-target logic for the nav tree
 * (CLAUDE.md Phase 1 preamble: native DnD first, no DnD library). Kept as
 * plain functions, separate from the DOM event wiring in `NavTree.tsx`, so
 * the actual move-decision logic is unit-testable without simulating drag
 * events.
 */
export const DRAG_MIME = "application/x-tundra-nav-drag";

export type DragPayload =
  | { kind: "note"; id: string }
  | { kind: "folder"; path: string }
  | { kind: "group"; id: string };

export function serializeDragPayload(payload: DragPayload): string {
  return JSON.stringify(payload);
}

/** Parses a drag payload, returning null for anything malformed or foreign (e.g. dragged text/files). */
export function parseDragPayload(data: string): DragPayload | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed && parsed.kind === "note" && typeof parsed.id === "string") {
      return { kind: "note", id: parsed.id };
    }
    if (parsed && parsed.kind === "folder" && typeof parsed.path === "string") {
      return { kind: "folder", path: parsed.path };
    }
    if (parsed && parsed.kind === "group" && typeof parsed.id === "string") {
      return { kind: "group", id: parsed.id };
    }
  } catch {
    // Not our payload — ignore.
  }
  return null;
}

/**
 * Whether dropping `dragged` INTO `targetFolder` (relative to the notes root,
 * `""` for root) is a valid, meaningful move: rejects dropping a folder onto
 * itself or into its own subtree (the same guard `vault.rs` enforces
 * server-side; checking here avoids a pointless round-trip and a confusing
 * error). A **group** never drops *into* a folder — it only reorders among the
 * top-level items — so this is always false for a group payload.
 */
export function canDropOnFolder(dragged: DragPayload, targetFolder: string): boolean {
  if (dragged.kind === "group") return false;
  if (dragged.kind === "folder") {
    if (dragged.path === targetFolder) return false;
    if (targetFolder.startsWith(`${dragged.path}/`)) return false;
  }
  return true;
}
