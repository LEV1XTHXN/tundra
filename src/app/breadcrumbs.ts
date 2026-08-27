/**
 * Turning a note's on-disk path into the top bar's breadcrumb.
 *
 * A note's canonical identity is its UUID, not its path (CLAUDE.md §5.3) — the
 * path is only ever a display aid, which is exactly what this is used for. The
 * folders shown are the real directories the note sits in, minus the vault's
 * `notes/` root, minus the file itself.
 */

/** The vault-relative prefix every note path carries (see the §5.2 layout). */
const NOTES_ROOT = "notes/";

/**
 * The folders between the notes root and `path`'s file, outermost first.
 * Returns `[]` for a note at the root, and for anything that doesn't look like
 * a note path — a breadcrumb is decoration, so it degrades to nothing rather
 * than guessing.
 */
export function noteCrumbs(path: string | undefined | null): string[] {
  if (!path) return [];
  // Vault paths are always `/`-separated, but a Windows-written config could
  // still carry backslashes; normalise before splitting.
  const normalised = path.replace(/\\/g, "/");
  const relative = normalised.startsWith(NOTES_ROOT)
    ? normalised.slice(NOTES_ROOT.length)
    : normalised;
  const segments = relative.split("/").filter(Boolean);
  // Drop the file name — the note's own title is the breadcrumb's leaf, and it
  // comes from the note, not from the file name (they diverge after a rename).
  return segments.slice(0, -1);
}
