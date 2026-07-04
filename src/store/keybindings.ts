/**
 * The live keybinding map: built-in defaults overlaid with the user's saved
 * overrides. This is UI/preference state (CLAUDE.md §8.5 — zustand holds view
 * state, never data); the overrides themselves are owned by Rust and persisted
 * to the app-config dir via the `appSettings` service, not `localStorage`.
 *
 * Only the *overrides* (bindings that differ from the default) are written, so
 * future changes to a default flow through to users who never rebound it.
 */
import { create } from "zustand";
import { appSettings } from "@/services";
import { DEFAULT_BINDINGS, type CommandId } from "@/keybindings/registry";

/** The app-settings blob name under which overrides persist. */
const SETTINGS_NAME = "keybindings";

type Bindings = Record<CommandId, string>;

/** The subset of `bindings` that differs from the defaults — what we persist. */
function overridesOf(bindings: Bindings): Partial<Bindings> {
  const out: Partial<Bindings> = {};
  for (const id in bindings) {
    const key = id as CommandId;
    if (bindings[key] !== DEFAULT_BINDINGS[key]) out[key] = bindings[key];
  }
  return out;
}

/** Merge persisted overrides onto the defaults, ignoring any unknown ids (e.g.
 *  a command removed in a later version). */
function mergeOverrides(overrides: Partial<Bindings> | null): Bindings {
  const merged: Bindings = { ...DEFAULT_BINDINGS };
  if (overrides) {
    for (const id in overrides) {
      if (id in DEFAULT_BINDINGS) {
        const v = overrides[id as CommandId];
        if (typeof v === "string") merged[id as CommandId] = v;
      }
    }
  }
  return merged;
}

/**
 * Command ids that share a binding with at least one other command — a real
 * conflict where a single combo maps to two actions. Unbound ("") entries are
 * ignored (multiple commands may be unbound).
 */
export function findConflicts(bindings: Bindings): Set<CommandId> {
  const byBinding = new Map<string, CommandId[]>();
  for (const id in bindings) {
    const b = bindings[id as CommandId];
    if (!b) continue;
    const list = byBinding.get(b) ?? [];
    list.push(id as CommandId);
    byBinding.set(b, list);
  }
  const conflicting = new Set<CommandId>();
  for (const list of byBinding.values()) {
    if (list.length > 1) list.forEach((id) => conflicting.add(id));
  }
  return conflicting;
}

interface KeybindingState {
  bindings: Bindings;
  /** True once the persisted overrides have been loaded (or found absent). */
  loaded: boolean;
  /** Load persisted overrides from Rust; call once on app boot. */
  load: () => Promise<void>;
  /** Set `id`'s binding to `binding` ("" to unbind) and persist. */
  setBinding: (id: CommandId, binding: string) => void;
  /** Restore `id` to its default binding and persist. */
  resetBinding: (id: CommandId) => void;
  /** Restore every binding to its default and persist. */
  resetAll: () => void;
}

export const useKeybindings = create<KeybindingState>((set, get) => {
  // Fire-and-forget persistence of the current overrides. Best-effort: a failed
  // write leaves the in-memory bindings active for the session; they're
  // recoverable preferences, never a source of truth.
  const persist = () => {
    void appSettings.write(SETTINGS_NAME, overridesOf(get().bindings)).catch(() => {});
  };

  return {
    bindings: { ...DEFAULT_BINDINGS },
    loaded: false,

    load: async () => {
      try {
        const overrides = await appSettings.read<Partial<Bindings>>(SETTINGS_NAME);
        set({ bindings: mergeOverrides(overrides), loaded: true });
      } catch {
        set({ loaded: true }); // keep defaults if the read fails
      }
    },

    setBinding: (id, binding) => {
      set((s) => ({ bindings: { ...s.bindings, [id]: binding } }));
      persist();
    },

    resetBinding: (id) => {
      set((s) => ({ bindings: { ...s.bindings, [id]: DEFAULT_BINDINGS[id] } }));
      persist();
    },

    resetAll: () => {
      set({ bindings: { ...DEFAULT_BINDINGS } });
      persist();
    },
  };
});
