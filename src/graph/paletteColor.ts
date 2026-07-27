/**
 * Resolve a CSS colour token to a concrete string the graph can hand to sigma.
 *
 * Sigma renders to WebGL/canvas, so it needs a resolved colour — it can't take
 * `var(--x)`. Rather than keep a second copy of the palette in TypeScript (which
 * silently drifts the moment index.css changes), the graph's colours are
 * declared as `--graph-*` tokens next to the palette itself and read back out
 * here. `getComputedStyle` collapses the whole `var()` chain, so a token that
 * points at `--pal-text-primary` arrives as a plain hex string.
 *
 * The theme lives on `<html>` as a `.dark` class, so reading from
 * documentElement always reflects the theme currently in effect — callers just
 * need to re-read when the theme flips (see GraphView's resolvedTheme effect).
 *
 * IMPORTANT: the `--graph-*` tokens must stay plain hex (or var() chains ending
 * in hex). A `color-mix()` computes to `color(srgb …)`, which sigma's colour
 * parser does not understand — it would render the node/edge black.
 */
export function readPaletteColor(token: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value || fallback;
}
