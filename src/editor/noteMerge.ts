import type { Banner, Icon, Note } from "@/services";

/**
 * A shallow patch over a {@link Note}, applied by {@link mergeNote}. Only keys
 * that are *present* are changed — so `mergeNote(n, { title, blocks })` rewrites
 * the body without touching `icon`/`meta`, while `{ icon: undefined }` explicitly
 * clears the icon. `pinned`/`banner` are folded into `meta` (with the same
 * `{ pinned: false, tags: [] }` fallback the editor has always used) so callers
 * never reconstruct the metadata object by hand.
 */
export interface NotePatch {
  title?: string;
  blocks?: Note["blocks"];
  icon?: Icon | undefined;
  pinned?: boolean;
  banner?: Banner | undefined;
}

const DEFAULT_META = { pinned: false, tags: [] };

/**
 * Build the next {@link Note} from the current one plus a {@link NotePatch}.
 * Pure (no editor/React state) so the save paths — body flush, icon, pin, banner,
 * save-as-template — share one well-tested merge instead of four near-identical
 * inline object literals. Key *presence* is significant; see {@link NotePatch}.
 */
export function mergeNote(base: Note, patch: NotePatch): Note {
  const touchesMeta = "pinned" in patch || "banner" in patch;
  const meta = touchesMeta
    ? {
        ...(base.meta ?? DEFAULT_META),
        ...("pinned" in patch ? { pinned: patch.pinned } : {}),
        ...("banner" in patch ? { banner: patch.banner ?? undefined } : {}),
      }
    : base.meta;
  return {
    ...base,
    ...("title" in patch ? { title: patch.title } : {}),
    ...("blocks" in patch ? { blocks: patch.blocks } : {}),
    ...("icon" in patch ? { icon: patch.icon } : {}),
    meta,
  };
}
