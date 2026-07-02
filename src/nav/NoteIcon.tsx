import { FileText } from "lucide-react";
import { icons as iconsService } from "@/services";
import type { Icon } from "@/services";
import { TwemojiImg } from "./twemojiImg";

/**
 * Renders a note's icon: an emoji as a local Twemoji SVG (CLAUDE.md Phase 1
 * preamble), a custom image via the Tauri asset protocol (`convertFileSrc`,
 * exposed via `services`), or a generic glyph if there's no icon.
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
    return <TwemojiImg codepoint={icon.value} className={className ?? "h-4 w-4"} />;
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
