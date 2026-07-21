import { create } from "zustand";
import { vault } from "@/services";
import type { VaultInfo } from "@/services";

/**
 * The known-vaults registry (CLAUDE.md §5.1) — every vault the user has
 * opened or created, most-recently-opened first. App-scoped (not tied to the
 * currently open vault), so both the sidebar's vault switcher and the
 * Settings vault section read the same list. Rust is the source of truth
 * (the app-config dir's `state.json`); this store just mirrors it for React.
 */
interface KnownVaultsState {
  vaults: VaultInfo[];
  loaded: boolean;
  /** Re-read the registry — call after any vault open (a switch/create moves
   *  it to the front) and after forgetting one. */
  refresh: () => Promise<void>;
  /** Remove a vault from the list ONLY; its files on disk are untouched. */
  forget: (path: string) => Promise<void>;
}

export const useKnownVaults = create<KnownVaultsState>((set, get) => ({
  vaults: [],
  loaded: false,
  refresh: async () => {
    const vaults = await vault.listKnown().catch(() => []);
    set({ vaults, loaded: true });
  },
  forget: async (path) => {
    await vault.forget(path);
    set({ vaults: get().vaults.filter((v) => v.path !== path) });
  },
}));
