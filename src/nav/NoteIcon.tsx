import twemoji from "@twemoji/api";
import { FileText } from "lucide-react";
import { icons as iconsService } from "@/services";
import type { Icon } from "@/services";
import { cn } from "@/lib/utils";

/**
 * Renders a note's icon: an emoji as a glyph from our bundled Twemoji COLR font
 * (the SINGLE emoji source shared with the picker and note bodies, so every
 * emoji in the app looks identical — see styles/twemoji.css), a custom image via
 * the Tauri asset protocol (`convertFileSrc`, exposed via `services`), or a
 * generic glyph if there's no icon.
 */
export function NoteIcon({
  icon,
  vaultPath,
  className,
}: {
  icon?: Icon | null;
  vaultPath: string;
  className?: string;
}) {
  if (icon?.type === "emoji") {
    // The font renders the emoji CHARACTER, so turn the stored codepoint(s)
    // (e.g. "1f331" or a hyphen-joined ZWJ sequence "1f468-200d-1f4bb") back
    // into the actual string. Size the square box + glyph from the caller's
    // size class so it lines up with where the SVG <img> used to sit.
    const px = iconSizePx(className);
    return (
      <span
        className={cn("twemoji-emoji", className)}
        style={{ fontSize: px, width: px, height: px }}
        aria-hidden
      >
        {codepointToEmoji(icon.value)}
      </span>
    );
  }
  if (icon?.type === "custom") {
    return (
      <img
        src={iconsService.assetUrl(vaultPath, icon.value)}
        alt=""
        className={className ?? "h-4 w-4 rounded-sm object-cover"}
      />
    );
  }
  return <FileText className={className ?? "h-4 w-4 text-muted-foreground"} />;
}

/** Rebuild an emoji string from its stored codepoint form (hyphen-joined for
 * multi-codepoint/ZWJ sequences), the same format the picker writes via
 * `twemoji.convert.toCodePoint`. */
function codepointToEmoji(codepoint: string): string {
  return codepoint
    .split("-")
    .map((hex) => twemoji.convert.fromCodePoint(hex))
    .join("");
}

/** Pixel size for the icon box, read from the caller's Tailwind size class
 * (`h-4`/`h-5`/`h-6`). Callers only ever pass square sizes; default to 16px. */
function iconSizePx(className?: string): number {
  if (className?.includes("h-6")) return 24;
  if (className?.includes("h-5")) return 20;
  return 16;
}
