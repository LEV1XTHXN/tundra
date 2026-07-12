import twemoji from "@twemoji/api";
import { FileText, Folder, Library } from "lucide-react";
import { icons as iconsService } from "@/services";
import type { Icon } from "@/services";
import { cn } from "@/lib/utils";

/** Which default glyph to show when there's no custom icon. */
const FALLBACK_GLYPH = { note: FileText, folder: Folder, group: Library } as const;

/**
 * Renders an icon: an emoji as a glyph from our bundled Twemoji COLR font (the
 * SINGLE emoji source shared with the picker and note bodies, so every emoji in
 * the app looks identical — see styles/twemoji.css), a custom image via the Tauri
 * asset protocol (`convertFileSrc`, exposed via `services`), or a generic glyph
 * if there's no icon. `fallback` picks the generic glyph (note/folder/group) —
 * the same component renders note, folder, and group icons.
 */
export function NoteIcon({
  icon,
  vaultPath,
  className,
  fallback = "note",
}: {
  icon?: Icon | null;
  vaultPath: string;
  className?: string;
  fallback?: keyof typeof FALLBACK_GLYPH;
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
        className={cn("rounded-sm object-cover", className ?? "h-4 w-4")}
      />
    );
  }
  const Glyph = FALLBACK_GLYPH[fallback];
  return <Glyph className={className ?? "h-4 w-4 text-muted-foreground"} />;
}

/** Rebuild an emoji string from its stored codepoint form (hyphen-joined for
 * multi-codepoint/ZWJ sequences), the same format the picker writes via
 * `twemoji.convert.toCodePoint`. */
export function codepointToEmoji(codepoint: string): string {
  return codepoint
    .split("-")
    .map((hex) => twemoji.convert.fromCodePoint(hex))
    .join("");
}

/** Pixel size for the icon box, read from the caller's Tailwind height class
 * (`h-4`, `h-10`, …). Tailwind's spacing scale is 0.25rem per step (`h-N` =
 * N×4px), so parse the number generically instead of enumerating sizes — that
 * kept large emoji (h-10+) rendering at the 16px fallback. Callers only ever
 * pass square sizes; default to 16px when no `h-N` class is present. */
function iconSizePx(className?: string): number {
  const match = className?.match(/(?:^|\s)h-(\d+)(?:\s|$)/);
  return match ? Number(match[1]) * 4 : 16;
}
