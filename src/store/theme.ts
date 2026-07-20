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

export type ThemePref = "system" | "light" | "dark";
type Resolved = "light" | "dark";
/** 24h ("13:00", the European/international default) or 12h ("1:00 PM"). */
export type TimeFormatPref = "24h" | "12h";
/** Editor content font size (BlockNote's own default is "medium" = 16px). */
export type EditorFontSizePref = "small" | "medium" | "large" | "xlarge";

/** The app-settings blob name under which appearance preferences persist. */
const SETTINGS_NAME = "appearance";

const EDITOR_FONT_SIZE_PX: Record<EditorFontSizePref, string> = {
  small: "14px",
  medium: "16px",
  large: "18px",
  xlarge: "20px",
};

interface AppearanceConfig {
  theme: ThemePref;
  timeFormat?: TimeFormatPref;
  /** Show a note's last-modified date in a tooltip on hover, in the nav tree
   *  and home dashboard note lists. Off by default. */
  showModifiedOnHover?: boolean;
  /** Editor content font size. Defaults to "medium" (BlockNote's own 16px). */
  editorFontSize?: EditorFontSizePref;
  /** Swap editor content to a dyslexia-friendly font (OpenDyslexic). Off by
   *  default; scoped to note/quick-note content only, not the app chrome. */
  dyslexiaFont?: boolean;
}

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
    document.documentElement.style.setProperty("--editor-font-size", EDITOR_FONT_SIZE_PX[size]);
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
  /** Load the persisted preference and start tracking the OS theme. */
  load: () => Promise<void>;
}

let mediaWired = false;

export const useTheme = create<ThemeState>((set, get) => ({
  theme: "system",
  resolved: resolvePref("system"),
  timeFormat: "24h",
  showModifiedOnHover: false,
  editorFontSize: "medium",
  dyslexiaFont: false,
  setTheme: (theme) => {
    const resolved = resolvePref(theme);
    applyToDom(resolved);
    set({ theme, resolved });
    const { timeFormat, showModifiedOnHover, editorFontSize, dyslexiaFont } = get();
    void appSettings
      .write(SETTINGS_NAME, { theme, timeFormat, showModifiedOnHover, editorFontSize, dyslexiaFont } satisfies AppearanceConfig)
      .catch(() => {});
  },
  setTimeFormat: (timeFormat) => {
    set({ timeFormat });
    const { theme, showModifiedOnHover, editorFontSize, dyslexiaFont } = get();
    void appSettings
      .write(SETTINGS_NAME, { theme, timeFormat, showModifiedOnHover, editorFontSize, dyslexiaFont } satisfies AppearanceConfig)
      .catch(() => {});
  },
  setShowModifiedOnHover: (showModifiedOnHover) => {
    set({ showModifiedOnHover });
    const { theme, timeFormat, editorFontSize, dyslexiaFont } = get();
    void appSettings
      .write(SETTINGS_NAME, { theme, timeFormat, showModifiedOnHover, editorFontSize, dyslexiaFont } satisfies AppearanceConfig)
      .catch(() => {});
  },
  setEditorFontSize: (editorFontSize) => {
    applyEditorFontSize(editorFontSize);
    set({ editorFontSize });
    const { theme, timeFormat, showModifiedOnHover, dyslexiaFont } = get();
    void appSettings
      .write(SETTINGS_NAME, { theme, timeFormat, showModifiedOnHover, editorFontSize, dyslexiaFont } satisfies AppearanceConfig)
      .catch(() => {});
  },
  setDyslexiaFont: (dyslexiaFont) => {
    applyDyslexiaFont(dyslexiaFont);
    set({ dyslexiaFont });
    const { theme, timeFormat, showModifiedOnHover, editorFontSize } = get();
    void appSettings
      .write(SETTINGS_NAME, { theme, timeFormat, showModifiedOnHover, editorFontSize, dyslexiaFont } satisfies AppearanceConfig)
      .catch(() => {});
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
    const editorFontSize = cfg?.editorFontSize ?? "medium";
    const dyslexiaFont = cfg?.dyslexiaFont ?? false;
    const resolved = resolvePref(theme);
    applyToDom(resolved);
    applyEditorFontSize(editorFontSize);
    applyDyslexiaFont(dyslexiaFont);
    set({ theme, resolved, timeFormat, showModifiedOnHover, editorFontSize, dyslexiaFont });
  },
}));
