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

/** The app-settings blob name under which appearance preferences persist. */
const SETTINGS_NAME = "appearance";

interface AppearanceConfig {
  theme: ThemePref;
  timeFormat?: TimeFormatPref;
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
  /** 24h by default (the international/European convention); 12h AM/PM opt-in. */
  timeFormat: TimeFormatPref;
  /** Change the preference, apply it, and persist it. */
  setTheme: (theme: ThemePref) => void;
  /** Change the clock format and persist it. */
  setTimeFormat: (timeFormat: TimeFormatPref) => void;
  /** Load the persisted preference and start tracking the OS theme. */
  load: () => Promise<void>;
}

let mediaWired = false;

export const useTheme = create<ThemeState>((set, get) => ({
  theme: "system",
  resolved: resolvePref("system"),
  timeFormat: "24h",
  setTheme: (theme) => {
    const resolved = resolvePref(theme);
    applyToDom(resolved);
    set({ theme, resolved });
    const { timeFormat } = get();
    void appSettings.write(SETTINGS_NAME, { theme, timeFormat } satisfies AppearanceConfig).catch(() => {});
  },
  setTimeFormat: (timeFormat) => {
    set({ timeFormat });
    const { theme } = get();
    void appSettings.write(SETTINGS_NAME, { theme, timeFormat } satisfies AppearanceConfig).catch(() => {});
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
    const resolved = resolvePref(theme);
    applyToDom(resolved);
    set({ theme, resolved, timeFormat });
  },
}));
