import { BookmarkPlus, ImageIcon, LayoutTemplate, Pin } from "lucide-react";

import type { Banner, Icon } from "@/services";
import { Input } from "@/components/ui/input";
import { NoteIcon } from "@/nav/NoteIcon";
import { IconPicker } from "@/nav/IconPicker";
import { BannerPicker, DEFAULT_BANNER } from "./NoteBanner";

interface EditorHeaderProps {
  vaultPath: string;
  /** Template mode hides note-only chrome (add-banner, use/save-template, pin). */
  isTemplateMode: boolean;
  icon: Icon | null | undefined;
  onIconChange: (icon: Icon | null) => void;
  title: string;
  onTitleChange: (value: string) => void;
  pinned: boolean;
  onTogglePin: () => void;
  banner: Banner | null | undefined;
  onBannerChange: (banner: Banner | null) => void;
  onUseTemplate: () => void;
  onSaveAsTemplate: () => void;
}

/**
 * The note editor's header row: icon picker, title input, and the note-only
 * action buttons (add-banner, use/save-template, pin). Pure presentation — all
 * state and persistence live in the editor hooks; this just wires their handlers.
 */
export function EditorHeader({
  vaultPath,
  isTemplateMode,
  icon,
  onIconChange,
  title,
  onTitleChange,
  pinned,
  onTogglePin,
  banner,
  onBannerChange,
  onUseTemplate,
  onSaveAsTemplate,
}: EditorHeaderProps) {
  return (
    <div className="editor-header">
      <IconPicker
        onChange={onIconChange}
        trigger={
          <button className="editor-title-icon-button" title="Set icon">
            <NoteIcon icon={icon} vaultPath={vaultPath} className="h-14 w-14" />
          </button>
        }
      />
      <Input
        className="h-auto border-none bg-transparent px-0 text-4xl md:text-4xl font-bold leading-tight shadow-none focus-visible:ring-0 dark:bg-transparent"
        value={title}
        placeholder="Untitled"
        onChange={(e) => onTitleChange(e.target.value)}
      />
      {/* Add-banner entry point — only when there's no cover yet; once a
          banner exists it's changed/removed from the strip's own controls. */}
      {!isTemplateMode && !banner && (
        <BannerPicker
          onChange={(b) => onBannerChange(b ?? DEFAULT_BANNER)}
          trigger={
            <button className="editor-icon-button" title="Add banner" aria-label="Add banner">
              <ImageIcon className="h-5 w-5" />
            </button>
          }
        />
      )}
      {/* Template actions — note mode only (a template doesn't use/save
          templates of itself). */}
      {!isTemplateMode && (
        <>
          <button
            className="editor-icon-button"
            onClick={onUseTemplate}
            title="Use template — insert a saved template"
            aria-label="Use template"
          >
            <LayoutTemplate className="h-5 w-5" />
          </button>
          <button
            className="editor-icon-button"
            onClick={onSaveAsTemplate}
            title="Save this note as a template"
            aria-label="Save as template"
          >
            <BookmarkPlus className="h-5 w-5" />
          </button>
        </>
      )}
      {!isTemplateMode && (
        <button
          className={`editor-icon-button${pinned ? " pinned" : ""}`}
          onClick={onTogglePin}
          title={pinned ? "Unpin from Home" : "Pin to Home"}
          aria-pressed={pinned}
        >
          <Pin className="h-5 w-5" fill={pinned ? "currentColor" : "none"} />
        </button>
      )}
    </div>
  );
}
