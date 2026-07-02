import { useState } from "react";
import twemoji from "@twemoji/api";
import { EmojiPicker } from "frimousse";
import { ImagePlus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { icons as iconsService } from "@/services";
import type { Icon } from "@/services";

interface IconPickerProps {
  trigger: React.ReactNode;
  onChange: (icon: Icon | null) => void;
}

/**
 * Emoji + custom-image icon picker (CLAUDE.md Phase 1 preamble). The emoji
 * list itself is served from a locally bundled copy of emojibase's English
 * data (`public/emojibase/en/`) rather than frimousse's CDN default, so the
 * picker works fully offline like the rest of the app.
 */
export function IconPicker({ trigger, onChange }: IconPickerProps) {
  const [open, setOpen] = useState(false);

  async function handleImportCustom() {
    const src = await iconsService.pickFile();
    if (!src) return;
    const rel = await iconsService.import(src);
    onChange({ type: "custom", value: rel });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="icon-picker-content" align="start">
        <EmojiPicker.Root
          className="icon-picker-emoji-root"
          emojibaseUrl="/emojibase"
          onEmojiSelect={({ emoji }) => {
            const codepoint = twemoji.convert.toCodePoint(emoji);
            onChange({ type: "emoji", value: codepoint });
            setOpen(false);
          }}
        >
          <EmojiPicker.Search className="icon-picker-search" />
          <EmojiPicker.Viewport className="icon-picker-viewport">
            <EmojiPicker.Loading className="muted">Loading…</EmojiPicker.Loading>
            <EmojiPicker.Empty className="muted">No emoji found.</EmojiPicker.Empty>
            <EmojiPicker.List />
          </EmojiPicker.Viewport>
        </EmojiPicker.Root>
        <div className="icon-picker-actions">
          <button className="icon-picker-action" onClick={handleImportCustom}>
            <ImagePlus size={14} /> Custom image…
          </button>
          <button
            className="icon-picker-action"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            <X size={14} /> Remove icon
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
