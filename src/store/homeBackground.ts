import { create } from "zustand";
import type { HomeBackground } from "@/home/HomeBackgroundPicker";

/**
 * The Home dashboard's current background customization, mirrored here so
 * the app SHELL (ribbon + sidebar, `App.tsx`) can react to it too — the shell
 * lives outside `Home.tsx`'s own component tree, but the "background bleeds
 * behind the chrome, chrome goes frosted" effect only makes sense while the
 * Home view is showing (see `App.tsx`'s `isHome` gate). `Home.tsx` is the
 * only writer (it owns `home.json`); this is UI/view state, not vault data,
 * so — like every other zustand store here — it's never the source of truth.
 *
 * Carries the vault path the value belongs to, alongside the value itself.
 * Right after switching vaults, `Home.tsx` unmounts/remounts and re-reads
 * `home.json` asynchronously — until that read resolves, this store would
 * otherwise still hold the PREVIOUS vault's background, and `App.tsx` would
 * render it against the NEW vault's path (`convertFileSrc(newVaultPath +
 * "/" + oldVault'sImagePath)`), a URL that can never resolve. Tagging the
 * value with its vault lets `App.tsx` simply ignore it when it's stale,
 * instead of depending on effect-ordering between this store's reset and
 * `Home.tsx`'s reload to always land in the right sequence.
 */
interface HomeBackgroundState {
  background: HomeBackground | null;
  vaultPath: string | null;
  setBackground: (background: HomeBackground | null, vaultPath: string) => void;
}

export const useHomeBackground = create<HomeBackgroundState>((set) => ({
  background: null,
  vaultPath: null,
  setBackground: (background, vaultPath) => set({ background, vaultPath }),
}));
