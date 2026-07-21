/**
 * Usage streak (Home dashboard's Streak widget): the number of consecutive
 * calendar days the user has both had the app open AND edited a note. Tracked
 * app-wide (not vault-scoped) via `appSettings` — like keybindings/appearance,
 * this is a personal habit, not vault content, so it follows the user across
 * vaults rather than resetting per-vault.
 *
 * `recordActivity()` is the only entry point, called from the note/quick-note
 * autosave paths (never on mere app open) — that's what ties the streak to
 * "logged in AND edited", since a save can only happen while the app runs.
 */
import { create } from "zustand";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { appSettings } from "@/services";

const SETTINGS_NAME = "activity";

interface ActivityConfig {
  /** ISO `yyyy-MM-dd`, local time — the last day activity was recorded. */
  lastActiveDate: string;
  currentStreak: number;
}

interface ActivityState {
  currentStreak: number;
  lastActiveDate: string | null;
  loaded: boolean;
  /** Load the persisted streak once on boot. */
  load: () => Promise<void>;
  /** Call after a successful note/quick-note save. No-op if already recorded
   *  today; extends the streak if the last active day was yesterday, otherwise
   *  restarts it at 1. */
  recordActivity: () => void;
}

function todayKey(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export const useActivity = create<ActivityState>((set, get) => ({
  currentStreak: 0,
  lastActiveDate: null,
  loaded: false,
  load: async () => {
    const cfg = await appSettings.read<ActivityConfig>(SETTINGS_NAME).catch(() => null);
    set({
      currentStreak: cfg?.currentStreak ?? 0,
      lastActiveDate: cfg?.lastActiveDate ?? null,
      loaded: true,
    });
  },
  recordActivity: () => {
    const today = todayKey();
    const { lastActiveDate, currentStreak } = get();
    if (lastActiveDate === today) return;
    const gap = lastActiveDate ? differenceInCalendarDays(parseISO(today), parseISO(lastActiveDate)) : null;
    const nextStreak = gap === 1 ? currentStreak + 1 : 1;
    set({ currentStreak: nextStreak, lastActiveDate: today });
    void appSettings
      .write(SETTINGS_NAME, { lastActiveDate: today, currentStreak: nextStreak } satisfies ActivityConfig)
      .catch(() => {});
  },
}));
