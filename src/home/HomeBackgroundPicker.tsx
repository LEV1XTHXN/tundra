/**
 * Home dashboard background customization — a small popover offering pastel
 * color presets or a custom image, mirroring `BannerPicker`'s pattern
 * (`editor/NoteBanner.tsx`). A custom image reuses the SAME content-addressed
 * image library AND orphan-protection gallery as note banners (`banners`
 * service / `.vault/config/banners.json`) rather than inventing a parallel
 * Rust-side mechanism — on disk, a Home background is exactly the same kind
 * of thing as a note cover image, just applied to a different view.
 */
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ImagePlus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { banners } from "@/services";
import { localizeError } from "@/i18n/errors";

export type HomeBackground = { type: "preset"; id: string } | { type: "image"; path: string };

/** Stock pastel presets — solid colors (not gradients like the banner
 *  presets) so the tint reads clearly through the widgets' translucent
 *  scrim (see `.home-widgets .widget` in index.css) without competing with
 *  widget content. Deliberately static across light/dark, same as
 *  `BANNER_GRADIENTS` — the widgets' own theme-relative scrim is what keeps
 *  text readable in both, not the preset colors adapting. */
export const HOME_BG_PRESETS: Record<string, string> = {
  blush: "#ffe1ec",
  sky: "#dceeff",
  mint: "#dbf6e7",
  peach: "#ffe6d5",
  lavender: "#eae0ff",
  citrus: "#fff3c4",
  sea: "#d7f4f1",
  sand: "#f3ecdc",
};

const PRESET_ORDER = Object.keys(HOME_BG_PRESETS);

/** The `.view-frame-body` style for a Home background, or `undefined` for
 *  "no customization" (the view keeps its normal chrome-colored body). */
export function homeBackgroundStyle(bg: HomeBackground | null, vaultPath: string): CSSProperties | undefined {
  if (!bg) return undefined;
  if (bg.type === "preset") {
    return { background: HOME_BG_PRESETS[bg.id] ?? HOME_BG_PRESETS[PRESET_ORDER[0]] };
  }
  return { background: `center / cover no-repeat url("${banners.assetUrl(vaultPath, bg.path)}")` };
}

export function HomeBackgroundPicker({
  trigger,
  background,
  vaultPath,
  onChange,
  onError,
}: {
  trigger: ReactNode;
  background: HomeBackground | null;
  vaultPath: string;
  onChange: (background: HomeBackground | null) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  async function handleUpload() {
    try {
      const src = await banners.pickFile();
      if (!src) return;
      const rel = await banners.import(src);
      // Registers it in the shared cover gallery purely so the orphan sweep
      // (Rust `collect_referenced_media`) never reclaims it — Home has no
      // gallery UI of its own, this is just the protection list.
      await banners.addToGallery(rel);
      onChange({ type: "image", path: rel });
      setOpen(false);
    } catch (e) {
      onError(localizeError(e, t));
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="banner-picker-content" align="end">
        <div className="banner-picker-label">{t("home.backgroundLabel")}</div>
        <div className="banner-picker-swatches">
          <button
            className={`banner-picker-swatch home-bg-swatch-none${!background ? " active" : ""}`}
            title={t("home.noBackground")}
            aria-label={t("home.noBackground")}
            aria-pressed={!background}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
          {background?.type === "image" && (
            <button
              className="banner-picker-swatch active"
              style={homeBackgroundStyle(background, vaultPath)}
              title={t("home.customBackgroundImage")}
              aria-label={t("home.customBackgroundImage")}
              aria-pressed
            />
          )}
          {PRESET_ORDER.map((id) => {
            const isActive = background?.type === "preset" && background.id === id;
            return (
              <button
                key={id}
                className={`banner-picker-swatch${isActive ? " active" : ""}`}
                style={{ background: HOME_BG_PRESETS[id] }}
                title={id}
                aria-label={`${id} background`}
                aria-pressed={isActive}
                onClick={() => {
                  onChange({ type: "preset", id });
                  setOpen(false);
                }}
              />
            );
          })}
        </div>
        <div className="banner-picker-actions">
          <button className="icon-picker-action" onClick={() => void handleUpload()}>
            <ImagePlus size={14} /> {t("home.uploadImage")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
