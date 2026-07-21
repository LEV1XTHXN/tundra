/**
 * The sidebar's vault name doubles as a switcher (CLAUDE.md §5.1: "Users can
 * switch or add vaults anytime from settings" — surfaced here rather than only
 * in Settings, since it's the natural place to reach for it). Lists every
 * known vault (`store/knownVaults.ts`); picking one just calls `open_vault`
 * with its path — switching, opening an existing vault elsewhere, and
 * creating a new one are all the same underlying operation.
 */
import { useEffect, useState } from "react";
import { Check, FolderOpen, FolderPlus, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { pickVaultFolder } from "@/services";
import type { VaultInfo } from "@/services";
import { useKnownVaults } from "@/store/knownVaults";
import { errorMessage } from "@/lib/errorMessage";

interface VaultSwitcherProps {
  vaultInfo: VaultInfo;
  /** Open (or create) the vault at `path` and make it active — from
   *  `useVaultSession`. Throws on failure, exactly like every other service call. */
  onSwitch: (path: string) => Promise<void>;
  onError: (message: string) => void;
}

export function VaultSwitcher({ vaultInfo, onSwitch, onError }: VaultSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const knownVaults = useKnownVaults((s) => s.vaults);
  const loaded = useKnownVaults((s) => s.loaded);
  const forget = useKnownVaults((s) => s.forget);

  // Safety net — the list is normally already populated (every vault open
  // refreshes it), but cover the case where that refresh silently failed.
  useEffect(() => {
    if (open && !loaded) void useKnownVaults.getState().refresh();
  }, [open, loaded]);

  const switchTo = async (path: string) => {
    if (path === vaultInfo.path) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await onSwitch(path);
      setOpen(false);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const openExisting = async () => {
    const path = await pickVaultFolder("Open a vault folder");
    if (path) await switchTo(path);
  };

  const createNew = async () => {
    const path = await pickVaultFolder("Choose or create a folder for the new vault");
    if (path) await switchTo(path);
  };

  const handleForget = async (path: string) => {
    try {
      await forget(path);
    } catch (e) {
      onError(errorMessage(e));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="vault-name" title={vaultInfo.path}>
          {vaultInfo.name}
        </button>
      </PopoverTrigger>
      <PopoverContent className="vault-switcher-popover" align="start">
        <div className="vault-switcher-heading">Vaults</div>
        {knownVaults.length > 0 && (
          <div className="vault-switcher-list">
            {knownVaults.map((v) => {
              const active = v.path === vaultInfo.path;
              return (
                <div key={v.path} className={`vault-switcher-item${active ? " active" : ""}`}>
                  <button
                    className="vault-switcher-item-main"
                    onClick={() => void switchTo(v.path)}
                    disabled={busy}
                  >
                    <span className="vault-switcher-item-check">
                      {active && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <span className="vault-switcher-item-info">
                      <span className="vault-switcher-item-name">{v.name}</span>
                      <span className="vault-switcher-item-path">{v.path}</span>
                    </span>
                  </button>
                  {!active && (
                    <button
                      className="vault-switcher-item-forget"
                      title="Remove from this list (keeps the vault's files on disk)"
                      aria-label={`Remove ${v.name} from the list`}
                      onClick={() => void handleForget(v.path)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="vault-switcher-actions">
          <button onClick={() => void openExisting()} disabled={busy}>
            <FolderOpen className="h-3.5 w-3.5" /> Open vault…
          </button>
          <button onClick={() => void createNew()} disabled={busy}>
            <FolderPlus className="h-3.5 w-3.5" /> Create new vault
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
