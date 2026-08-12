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
   *  it to the front) and after deleting one. */
  refresh: () => Promise<void>;
  /** Delete a vault: its folder goes to the OS trash and it leaves the list.
   *  Resolves `true` if the deleted vault was the open one — the caller then
   *  has no vault open and must fall back to onboarding (`useVaultSession`). */
  remove: (path: string) => Promise<boolean>;
}

export const useKnownVaults = create<KnownVaultsState>((set, get) => ({
  vaults: [],
  loaded: false,
  refresh: async () => {
    const vaults = await vault.listKnown().catch(() => []);
    set({ vaults, loaded: true });
  },
  remove: async (path) => {
    const wasOpen = await vault.delete(path);
    set({ vaults: get().vaults.filter((v) => v.path !== path) });
    return wasOpen;
  },
}));
