/**
 * Appearance / theme (Phase 3 step 6). The user picks system / light / dark;
 * "system" follows the OS and tracks live changes. Dark mode is class-based —
 * Tailwind's `dark` variant keys off a `.dark` ancestor (see index.css
 * `@custom-variant dark`), so we toggle `.dark` on `<html>`.
 *
 * This is a UI preference (CLAUDE.md §8.5 — zustand holds view state), and the
 * preference itself is owned by Rust and persisted through the `appSettings`
 * service (app-config dir), never `localStorage`.
 */
import { create } from "zustand";
import { appSettings } from "@/services";

export type ThemePref = "system" | "light" | "dark";
type Resolved = "light" | "dark";

/** The app-settings blob name under which the theme preference persists. */
const SETTINGS_NAME = "appearance";

interface AppearanceConfig {
  theme: ThemePref;
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

interface ThemeState {
  /** The user's chosen preference. */
  theme: ThemePref;
  /** The concrete theme in effect right now (what components/editor use). */
  resolved: Resolved;
  /** Change the preference, apply it, and persist it. */
  setTheme: (theme: ThemePref) => void;
  /** Load the persisted preference and start tracking the OS theme. */
  load: () => Promise<void>;
}

let mediaWired = false;

export const useTheme = create<ThemeState>((set, get) => ({
  theme: "system",
  resolved: resolvePref("system"),
  setTheme: (theme) => {
    const resolved = resolvePref(theme);
    applyToDom(resolved);
    set({ theme, resolved });
    void appSettings.write(SETTINGS_NAME, { theme } satisfies AppearanceConfig).catch(() => {});
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
    const resolved = resolvePref(theme);
    applyToDom(resolved);
    set({ theme, resolved });
  },
}));
