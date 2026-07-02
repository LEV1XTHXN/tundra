/**
 * Local-first Twemoji SVG lookup (CLAUDE.md Phase 1 preamble: render emoji as
 * SVG from the stored codepoint, via the maintained jdecked fork — never a
 * CDN, so icon rendering works fully offline). `@twemoji/svg` ships the
 * actual SVG files named `<codepoint>.svg`, one per emoji.
 *
 * Loaded lazily (not `eager: true`): with ~3700 SVGs in the package, eagerly
 * globbing them all inflated the main JS bundle by ~7MB for icons almost no
 * note will actually use yet (no picker exists until Phase 1 step 7). Each
 * SVG becomes its own tiny on-demand chunk instead.
 */
const svgLoaders = import.meta.glob("/node_modules/@twemoji/svg/*.svg", {
  query: "?url",
  import: "default",
}) as Record<string, () => Promise<string>>;

const byCodepoint = new Map<string, () => Promise<string>>();
for (const [path, loader] of Object.entries(svgLoaders)) {
  const codepoint = path.split("/").pop()?.replace(/\.svg$/, "");
  if (codepoint) byCodepoint.set(codepoint, loader);
}

const resolvedCache = new Map<string, string>();

/** Resolve the URL for a Twemoji SVG by stored codepoint (e.g. `"1f331"`), or undefined if unknown. */
export async function twemojiUrl(codepoint: string): Promise<string | undefined> {
  const cp = codepoint.toLowerCase();
  const cached = resolvedCache.get(cp);
  if (cached) return cached;

  const loader = byCodepoint.get(cp);
  if (!loader) return undefined;

  const url = await loader();
  resolvedCache.set(cp, url);
  return url;
}
