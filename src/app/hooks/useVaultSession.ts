import { useCallback, useEffect, useRef, useState } from "react";
import { pickVaultFolder, vault } from "@/services";
import type { NoteSummary, VaultInfo } from "@/services";
import { errorMessage } from "@/lib/errorMessage";
import { useViewState } from "@/store/viewState";
import { useKnownVaults } from "@/store/knownVaults";

export interface VaultSession {
  vaultInfo: VaultInfo | null;
  booting: boolean;
  error: string | null;
  setError: (msg: string | null) => void;
  onChooseFolder: () => Promise<void>;
  onUseDefault: () => Promise<void>;
  /** Open (or create) the vault at `path` and make it the active one — used
   *  by onboarding AND by the vault switcher to switch to a known/new vault.
   *  There's no separate "switch" command: `open_vault` already does it. */
  switchVault: (path: string) => Promise<void>;
}

/**
 * Owns the open vault + boot/onboarding lifecycle: reopen the last vault on
 * launch (so returning users skip onboarding), and the two onboarding paths
 * (pick a folder / use the default vault). `refreshTree` is injected so the
 * tree stays an independent concern — the session just calls it after a vault
 * opens. Also owns the shell-wide `error` string surfaced by the toast.
 */
export function useVaultSession(
  refreshTree: () => Promise<NoteSummary[]>,
): VaultSession {
  const [vaultInfo, setVaultInfo] = useState<VaultInfo | null>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const switchVault = useCallback(
    async (path: string) => {
      setError(null);
      try {
        const info = await vault.open(path);
        setVaultInfo(info);
        // A different vault's notes/folders/templates have nothing to do with
        // whatever the previous vault had open — land back on Home rather
        // than pointing at now-meaningless ids.
        useViewState.getState().resetForVaultSwitch();
        await refreshTree();
        // This vault just moved to the front of the known-vaults registry
        // (open_vault does that server-side) — refresh so the switcher/
        // Settings list reflects it immediately.
        void useKnownVaults.getState().refresh();
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [refreshTree],
  );

  // On launch, reopen the last vault so returning users skip onboarding.
  // Guarded against React StrictMode's dev-only double-invocation of effects:
  // without this, two concurrent `open_vault` calls race to construct the
  // Tantivy search index for the same directory and one fails with LockBusy.
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    (async () => {
      try {
        const last = await vault.last();
        if (last) {
          const info = await vault.open(last);
          setVaultInfo(info);
          await refreshTree();
          void useKnownVaults.getState().refresh();
        }
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBooting(false);
      }
    })();
  }, [refreshTree]);

  const onChooseFolder = useCallback(async () => {
    const path = await pickVaultFolder();
    if (path) await switchVault(path);
  }, [switchVault]);

  const onUseDefault = useCallback(async () => {
    try {
      await switchVault(await vault.defaultPath());
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [switchVault]);

  return { vaultInfo, booting, error, setError, onChooseFolder, onUseDefault, switchVault };
}
