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
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { pickVaultFolder } from "@/services";
import type { VaultInfo } from "@/services";
import { useKnownVaults } from "@/store/knownVaults";
import { localizeError } from "@/i18n/errors";

interface VaultSwitcherProps {
  vaultInfo: VaultInfo;
  /** Open (or create) the vault at `path` and make it active — from
   *  `useVaultSession`. Throws on failure, exactly like every other service call. */
  onSwitch: (path: string) => Promise<void>;
  /** Delete the vault at `path`, moving its whole folder to the OS trash — also
   *  from `useVaultSession`, which handles the case where it was the open one. */
  onDelete: (path: string) => Promise<void>;
  onError: (message: string) => void;
}

export function VaultSwitcher({ vaultInfo, onSwitch, onDelete, onError }: VaultSwitcherProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // The vault the user clicked the trash icon on, awaiting confirmation. Held
  // here rather than in `useDeletion`'s `PendingDelete` union: that one is
  // wired to the note/folder/template flows inside a vault, and this is the
  // one deletion that can remove the vault those flows operate on.
  const [pendingDelete, setPendingDelete] = useState<VaultInfo | null>(null);
  const knownVaults = useKnownVaults((s) => s.vaults);
  const loaded = useKnownVaults((s) => s.loaded);

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
      onError(localizeError(e, t));
    } finally {
      setBusy(false);
    }
  };

  const openExisting = async () => {
    const path = await pickVaultFolder(t("vaultSwitcher.openVaultFolder"));
    if (path) await switchTo(path);
  };

  const createNew = async () => {
    const path = await pickVaultFolder(t("vaultSwitcher.chooseOrCreateFolder"));
    if (path) await switchTo(path);
  };

  /** Ask first — this is the one action in the app that removes a whole vault
   *  from disk. Closing the popover is deliberate: the dialog renders outside
   *  it, so leaving it open would just have the two fighting over focus. */
  const requestDelete = (target: VaultInfo) => {
    setPendingDelete(target);
    setOpen(false);
  };

  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    setBusy(true);
    try {
      await onDelete(target.path);
    } catch (e) {
      onError(localizeError(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="vault-name" title={vaultInfo.path}>
            {vaultInfo.name}
          </button>
        </PopoverTrigger>
        <PopoverContent className="vault-switcher-popover" align="start">
          <div className="vault-switcher-heading">{t("vaultSwitcher.title")}</div>
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
                    <button
                      className="vault-switcher-item-delete"
                      title={t("vaultSwitcher.deleteVault")}
                      aria-label={t("vaultSwitcher.deleteVaultAria", { name: v.name })}
                      onClick={() => requestDelete(v)}
                      disabled={busy}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="vault-switcher-actions">
            <button onClick={() => void openExisting()} disabled={busy}>
              <FolderOpen className="h-3.5 w-3.5" /> {t("vaultSwitcher.openVault")}
            </button>
            <button onClick={() => void createNew()} disabled={busy}>
              <FolderPlus className="h-3.5 w-3.5" /> {t("vaultSwitcher.createNewVault")}
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("vaultSwitcher.deleteTitle", { name: pendingDelete?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("vaultSwitcher.deleteDescription")}
              {pendingDelete?.path === vaultInfo.path && (
                <> {t("vaultSwitcher.deleteOpenVaultNote")}</>
              )}
              <span className="vault-switcher-delete-path">{pendingDelete?.path}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("vaultSwitcher.deleteCancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>
              {t("vaultSwitcher.deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
