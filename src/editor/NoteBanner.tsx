/**
 * Per-note banner (cover) — the wide strip above the title/icon in the editor
 * header. A banner is either a built-in pastel **gradient** preset (rendered
 * from `BANNER_GRADIENTS`, no vault file) or a user **image** stored in the
 * vault's `attachments/images/` library. React renders only; the image bytes are
 * copied into the vault by the core via the `banners` service — this module
 * never touches the file system (CLAUDE.md §2).
 */
import { useEffect, useState } from "react";
import { ImagePlus, Trash2, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { attachments, banners } from "@/services";
import type { Banner } from "@/services";

/**
 * The built-in pastel gradient presets, keyed by the id stored in the note
 * (`Banner::Gradient(id)`). The colours live here in the frontend — the vault
 * only ever stores the id, so re-theming a preset later can never require
 * touching users' note files. `background` is used verbatim as a CSS value.
 */
export const BANNER_GRADIENTS: Record<string, string> = {
  blush: "linear-gradient(120deg, #ffd9e8 0%, #ffe9d6 100%)",
  sky: "linear-gradient(120deg, #d6ecff 0%, #e6dcff 100%)",
  mint: "linear-gradient(120deg, #d4f5e4 0%, #d9f0ff 100%)",
  peach: "linear-gradient(120deg, #ffe3d3 0%, #ffd6e0 100%)",
  lavender: "linear-gradient(120deg, #e7dcff 0%, #ffe0f2 100%)",
  citrus: "linear-gradient(120deg, #fff3c4 0%, #ffe0c7 100%)",
  sea: "linear-gradient(120deg, #cdeeff 0%, #d3f7f0 100%)",
  dusk: "linear-gradient(120deg, #ffd6e7 0%, #d7d9ff 60%, #cfeeff 100%)",
};

/** Ordered preset ids for the picker swatches (object key order isn't guaranteed
 *  to be meaningful, so pin the display order explicitly). */
const GRADIENT_ORDER = Object.keys(BANNER_GRADIENTS);

/** The default banner applied by the "Add banner" affordance — the first preset,
 *  so one click gives a sensible cover the user can then swap. */
export const DEFAULT_BANNER: Banner = { type: "gradient", value: GRADIENT_ORDER[0] };

/** The CSS `background` value for a banner: the preset gradient, the image as a
 *  cover-fit `url()`, or (unknown/removed preset) a neutral fallback. */
function bannerBackground(banner: Banner, vaultPath: string): string {
  if (banner.type === "gradient") {
    return BANNER_GRADIENTS[banner.value] ?? BANNER_GRADIENTS[GRADIENT_ORDER[0]];
  }
  // An image reads the Tauri asset:// URL directly from CSS via an <img>-backed
  // element is safest cross-platform; here we use it as a background layer.
  return `center / cover no-repeat url("${banners.assetUrl(vaultPath, banner.value)}")`;
}

/**
 * The rendered banner strip plus its hover controls (change / remove). Shown
 * only when the note has a banner; the "Add banner" entry point lives in the
 * editor header (NoteEditor.tsx) so it can sit beside the other header buttons
 * when there is no cover yet.
 */
export function NoteBanner({
  banner,
  vaultPath,
  onChange,
}: {
  banner: Banner;
  vaultPath: string;
  onChange: (banner: Banner | null) => void;
}) {
  return (
    <div className="note-banner" style={{ background: bannerBackground(banner, vaultPath) }}>
      <div className="note-banner-controls">
        <BannerPicker
          banner={banner}
          vaultPath={vaultPath}
          onChange={onChange}
          trigger={
            <button className="note-banner-button" title="Change banner">
              Change cover
            </button>
          }
        />
        <button
          className="note-banner-button"
          title="Remove banner"
          onClick={() => onChange(null)}
        >
          <Trash2 size={14} />
          Remove
        </button>
      </div>
    </div>
  );
}

/**
 * The banner chooser popover: every uploaded custom cover is saved in a
 * vault-scoped gallery and shown as a swatch in the same grid as the pastel
 * gradient presets — so a custom image stays re-selectable even after a note's
 * cover is removed. Each gallery swatch has a delete (×) to drop it from the
 * gallery for good; an "Upload image…" action adds a new one. The currently
 * applied cover is highlighted. Mirrors `IconPicker`'s trigger + popover pattern.
 */
export function BannerPicker({
  trigger,
  banner,
  vaultPath,
  onChange,
}: {
  trigger: React.ReactNode;
  banner: Banner | null | undefined;
  vaultPath: string;
  onChange: (banner: Banner | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [gallery, setGallery] = useState<string[]>([]);

  // Load the saved gallery whenever the popover opens. If the note's current
  // cover is an image not yet saved (e.g. set before the gallery existed), fold
  // it in so it persists and gets a swatch like any other.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      let list = await banners.gallery();
      if (banner?.type === "image" && !list.includes(banner.value)) {
        list = await banners.addToGallery(banner.value);
      }
      if (alive) setGallery(list);
    })();
    return () => {
      alive = false;
    };
  }, [open, banner]);

  async function handleUpload() {
    const src = await banners.pickFile();
    if (!src) return;
    const rel = await banners.import(src);
    setGallery(await banners.addToGallery(rel));
    onChange({ type: "image", value: rel });
    setOpen(false);
  }

  async function handleDeleteFromGallery(path: string) {
    // If the deleted image is this note's active cover, clear the cover first so
    // nothing references the file — then the sweep can actually reclaim it.
    if (banner?.type === "image" && banner.value === path) onChange(null);
    setGallery(await banners.removeFromGallery(path));
    void attachments.cleanupOrphans().catch(() => {});
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="banner-picker-content" align="start">
        <div className="banner-picker-label">Covers</div>
        <div className="banner-picker-swatches">
          {gallery.map((path) => {
            const image: Banner = { type: "image", value: path };
            const isActive = banner?.type === "image" && banner.value === path;
            return (
              <div key={path} className="banner-picker-swatch-wrap">
                <button
                  className={`banner-picker-swatch${isActive ? " active" : ""}`}
                  style={{ background: bannerBackground(image, vaultPath) }}
                  title="Custom cover image"
                  aria-label="Custom cover image"
                  aria-pressed={isActive}
                  onClick={() => {
                    onChange(image);
                    setOpen(false);
                  }}
                />
                <button
                  className="banner-picker-swatch-remove"
                  title="Delete from gallery"
                  aria-label="Delete cover from gallery"
                  onClick={() => void handleDeleteFromGallery(path)}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
          {GRADIENT_ORDER.map((id) => {
            const isActive = banner?.type === "gradient" && banner.value === id;
            return (
              <button
                key={id}
                className={`banner-picker-swatch${isActive ? " active" : ""}`}
                style={{ background: BANNER_GRADIENTS[id] }}
                title={id}
                aria-label={`${id} gradient banner`}
                aria-pressed={isActive}
                onClick={() => {
                  onChange({ type: "gradient", value: id });
                  setOpen(false);
                }}
              />
            );
          })}
        </div>
        <div className="banner-picker-actions">
          <button className="icon-picker-action" onClick={handleUpload}>
            <ImagePlus size={14} /> Upload image…
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
