/**
 * Support for the graph's optional "emoji nodes" setting: turn a note's own
 * icon (set via the same emoji picker used everywhere else — `IconPicker`)
 * into a bitmap for sigma's node-image/texture-atlas program
 * (`@sigma/node-image`), when that icon is an emoji. Rasterization is the only
 * per-emoji cost here — it's memoized by emoji string, so a vault with
 * thousands of notes but a few dozen distinct emoji icons only ever draws
 * those few dozen bitmaps once each, regardless of how many nodes reuse them.
 * `GraphView` is responsible for never calling this more than once per
 * distinct emoji (see its atlas-build effect).
 */
import { codepointToEmoji } from "../nav/NoteIcon";
import type { Icon } from "../services";

/** Bitmap size (px) rasterized per distinct emoji. Fixed and generous — nodes
 *  never draw anywhere near this large on screen, and `@sigma/node-image`
 *  downscales for display, so one size keeps the atlas simple without a
 *  per-node-size rasterization matrix. */
export const EMOJI_RASTER_SIZE = 128;

/** The emoji character for a note's icon, or `null` when it has no icon or a
 *  custom (non-emoji) one — those keep the default dot regardless of the
 *  setting. */
export function iconEmoji(icon: Icon | null | undefined): string | null {
  return icon?.type === "emoji" ? codepointToEmoji(icon.value) : null;
}

/** Rasterize one emoji to a PNG data URL using the app's Twemoji colour font —
 *  the SAME font every other emoji surface in the app renders from (see
 *  `styles/twemoji.css`), so graph nodes match note icons exactly. Memoized by
 *  emoji string: concurrent/duplicate calls for the same emoji share one canvas
 *  draw and one promise. */
const rasterCache = new Map<string, Promise<string>>();

export function rasterizeEmoji(emoji: string): Promise<string> {
  let cached = rasterCache.get(emoji);
  if (!cached) {
    cached = (async () => {
      await document.fonts.load(`${EMOJI_RASTER_SIZE}px Twemoji`, emoji);
      const canvas = document.createElement("canvas");
      canvas.width = EMOJI_RASTER_SIZE;
      canvas.height = EMOJI_RASTER_SIZE;
      const ctx = canvas.getContext("2d")!;
      ctx.font = `${Math.round(EMOJI_RASTER_SIZE * 0.82)}px Twemoji`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(emoji, EMOJI_RASTER_SIZE / 2, EMOJI_RASTER_SIZE / 2 + EMOJI_RASTER_SIZE * 0.04);
      return canvas.toDataURL("image/png");
    })();
    rasterCache.set(emoji, cached);
  }
  return cached;
}
