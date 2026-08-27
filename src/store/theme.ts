/**
 * Appearance (Phase 3 step 6, extended): theme (system/light/dark) and clock
 * format (24h/12h), both persisted together under one app-settings blob.
 * "system" theme follows the OS and tracks live changes. Dark mode is
 * class-based — Tailwind's `dark` variant keys off a `.dark` ancestor (see
 * index.css `@custom-variant dark`), so we toggle `.dark` on `<html>`.
 *
 * This is a UI preference (CLAUDE.md §8.5 — zustand holds view state), and the
 * preference itself is owned by Rust and persisted through the `appSettings`
 * service (app-config dir), never `localStorage`.
 */
import { create } from "zustand";
import { appSettings } from "@/services";
import type { AppView } from "./viewState";

export type ThemePref = "system" | "light" | "dark";
type Resolved = "light" | "dark";
/** 24h ("13:00", the European/international default) or 12h ("1:00 PM"). */
export type TimeFormatPref = "24h" | "12h";
/** Editor content font size in pixels. BlockNote's own default is 16. */
export type EditorFontSizePref = number;

/** The app-settings blob name under which appearance preferences persist. */
const SETTINGS_NAME = "appearance";

/** Slider bounds and default for the editor content font size (pixels). */
export const EDITOR_FONT_SIZE_MIN = 12;
export const EDITOR_FONT_SIZE_MAX = 24;
export const EDITOR_FONT_SIZE_DEFAULT = 16;

/** Legacy string presets (pre-slider) mapped to their pixel sizes, so configs
 *  written by older versions still load correctly. */
const LEGACY_FONT_SIZE_PX: Record<string, number> = {
  small: 14,
  medium: 16,
  large: 18,
  xlarge: 20,
};

interface AppearanceConfig {
  theme: ThemePref;
  timeFormat?: TimeFormatPref;
  /** Show a note's last-modified date in a tooltip on hover, in the nav tree
   *  and home dashboard note lists. Off by default. */
  showModifiedOnHover?: boolean;
  /** Editor content font size in pixels. Older versions persisted a string
   *  preset ("small"/"medium"/…); load() normalizes those. */
  editorFontSize?: EditorFontSizePref | string;
  /** Swap editor content to a dyslexia-friendly font (OpenDyslexic). Off by
   *  default; scoped to note/quick-note content only, not the app chrome. */
  dyslexiaFont?: boolean;
  /** Whether the shell's icon ribbon is slid open (icons + labels) rather than
   *  collapsed to icons only. On by default. */
  ribbonExpanded?: boolean;
  /** Views whose note-tree column is hidden, as a plain array (JSON has no Set).
   *  Absent = the built-in defaults; an empty array means "shown everywhere". */
  treeHiddenViews?: string[];
}

/** Views that open with the note tree hidden until the user says otherwise:
 *  a board, a canvas and a settings page have nothing to do with the tree, and
 *  every mockup frame for them is drawn without it. */
const TREE_HIDDEN_BY_DEFAULT: readonly AppView[] = ["kanban", "graph", "settings"];

function systemDark(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

function resolvePref(pref: ThemePref): Resolved {
  return pref === "system" ? (systemDark() ? "dark" : "light") : pref;
}

function applyToDom(resolved: Resolved): void {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }
}

function applyEditorFontSize(size: EditorFontSizePref): void {
  if (typeof document !== "undefined") {
    const px = Math.min(EDITOR_FONT_SIZE_MAX, Math.max(EDITOR_FONT_SIZE_MIN, size));
    document.documentElement.style.setProperty("--editor-font-size", `${px}px`);
  }
}

function applyDyslexiaFont(enabled: boolean): void {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dyslexia-font", enabled);
  }
}

interface ThemeState {
  /** The user's chosen preference. */
  theme: ThemePref;
  /** The concrete theme in effect right now (what components/editor use). */
  resolved: Resolved;
  /** 24h by default (the international/European convention); 12h AM/PM opt-in. */
  timeFormat: TimeFormatPref;
  /** Off by default; when on, hovering a note shows its last-modified date. */
  showModifiedOnHover: boolean;
  /** Editor content font size; "medium" (16px) by default. */
  editorFontSize: EditorFontSizePref;
  /** Dyslexia-friendly editor content font; off by default. */
  dyslexiaFont: boolean;
  /** Icon ribbon slid open (icons + labels); open by default. */
  ribbonExpanded: boolean;
  /** Views whose note-tree column is currently hidden. Per-view rather than
   *  global so the tree can stay on in Notes while Kanban runs full width. */
  treeHiddenViews: ReadonlySet<AppView>;
  /** Change the preference, apply it, and persist it. */
  setTheme: (theme: ThemePref) => void;
  /** Change the clock format and persist it. */
  setTimeFormat: (timeFormat: TimeFormatPref) => void;
  /** Toggle the hover tooltip and persist it. */
  setShowModifiedOnHover: (show: boolean) => void;
  /** Change the editor content font size and persist it. */
  setEditorFontSize: (size: EditorFontSizePref) => void;
  /** Toggle the dyslexia-friendly editor content font and persist it. */
  setDyslexiaFont: (enabled: boolean) => void;
  /** Slide the icon ribbon open/closed and persist it. */
  setRibbonExpanded: (expanded: boolean) => void;
  /** Show/hide the note-tree column for ONE view, and persist it. */
  toggleTree: (view: AppView) => void;
  /** Load the persisted preference and start tracking the OS theme. */
  load: () => Promise<void>;
}

let mediaWired = false;

export const useTheme = create<ThemeState>((set, get) => {
  /** Write the whole appearance blob from current state — every setter calls
   *  this after `set()`, so a new preference only has to be added in one place. */
  const persist = () => {
    const {
      theme,
      timeFormat,
      showModifiedOnHover,
      editorFontSize,
      dyslexiaFont,
      ribbonExpanded,
      treeHiddenViews,
    } = get();
    void appSettings
      .write(SETTINGS_NAME, {
        theme,
        timeFormat,
        showModifiedOnHover,
        editorFontSize,
        dyslexiaFont,
        ribbonExpanded,
        treeHiddenViews: [...treeHiddenViews],
      } satisfies AppearanceConfig)
      .catch(() => {});
  };

  return {
  theme: "system",
  resolved: resolvePref("system"),
  timeFormat: "24h",
  showModifiedOnHover: false,
  editorFontSize: EDITOR_FONT_SIZE_DEFAULT,
  dyslexiaFont: false,
  ribbonExpanded: true,
  treeHiddenViews: new Set(TREE_HIDDEN_BY_DEFAULT),
  setTheme: (theme) => {
    const resolved = resolvePref(theme);
    applyToDom(resolved);
    set({ theme, resolved });
    persist();
  },
  setTimeFormat: (timeFormat) => {
    set({ timeFormat });
    persist();
  },
  setShowModifiedOnHover: (showModifiedOnHover) => {
    set({ showModifiedOnHover });
    persist();
  },
  setEditorFontSize: (editorFontSize) => {
    applyEditorFontSize(editorFontSize);
    set({ editorFontSize });
    persist();
  },
  setDyslexiaFont: (dyslexiaFont) => {
    applyDyslexiaFont(dyslexiaFont);
    set({ dyslexiaFont });
    persist();
  },
  setRibbonExpanded: (ribbonExpanded) => {
    set({ ribbonExpanded });
    persist();
  },
  toggleTree: (view) => {
    const next = new Set(get().treeHiddenViews);
    if (!next.delete(view)) next.add(view);
    set({ treeHiddenViews: next });
    persist();
  },
  load: async () => {
    // Track OS theme changes once, so "system" updates live without a restart.
    if (!mediaWired && typeof window !== "undefined" && window.matchMedia) {
      mediaWired = true;
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (get().theme === "system") {
          const resolved = resolvePref("system");
          applyToDom(resolved);
          set({ resolved });
        }
      });
    }
    const cfg = await appSettings.read<AppearanceConfig>(SETTINGS_NAME).catch(() => null);
    const theme = cfg?.theme ?? "system";
    const timeFormat = cfg?.timeFormat ?? "24h";
    const showModifiedOnHover = cfg?.showModifiedOnHover ?? false;
    const rawFontSize = cfg?.editorFontSize;
    const editorFontSize =
      typeof rawFontSize === "number"
        ? rawFontSize
        : typeof rawFontSize === "string"
          ? LEGACY_FONT_SIZE_PX[rawFontSize] ?? EDITOR_FONT_SIZE_DEFAULT
          : EDITOR_FONT_SIZE_DEFAULT;
    const dyslexiaFont = cfg?.dyslexiaFont ?? false;
    const ribbonExpanded = cfg?.ribbonExpanded ?? true;
    const treeHiddenViews = new Set(
      (cfg?.treeHiddenViews as AppView[] | undefined) ?? TREE_HIDDEN_BY_DEFAULT,
    );
    const resolved = resolvePref(theme);
    applyToDom(resolved);
    applyEditorFontSize(editorFontSize);
    applyDyslexiaFont(dyslexiaFont);
    set({
      theme,
      resolved,
      timeFormat,
      showModifiedOnHover,
      editorFontSize,
      dyslexiaFont,
      ribbonExpanded,
      treeHiddenViews,
    });
  },
  };
});
