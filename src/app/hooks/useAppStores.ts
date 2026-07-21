import { useEffect } from "react";
import type { VaultInfo } from "@/services";
import { useKeybindings } from "@/store/keybindings";
import { useTheme } from "@/store/theme";
import { useActivity } from "@/store/activity";
import { useTagColors, useKanbanTags, useVaultTags } from "@/store/tagColors";
import { useFolderViews } from "@/store/folderViews";
import { useTemplates } from "@/store/templates";
import { useFolderGroups } from "@/store/folderGroups";

/**
 * Loads the persisted zustand stores at the right lifecycle point. App-scoped
 * preferences (keybindings, theme, usage streak) load once on mount, before any
 * shortcut can fire. Vault-scoped config (tag colors, kanban/vault tags, folder
 * views, templates, folder groups) re-loads whenever the open vault changes, so
 * switching vaults re-reads config rather than keeping the previous vault's.
 * Side-effect only — the stores expose the loaded data to their own consumers.
 */
export function useAppStores(vaultInfo: VaultInfo | null): void {
  // App-scoped: load once on boot, independent of the vault.
  useEffect(() => {
    void useKeybindings.getState().load();
  }, []);
  useEffect(() => {
    void useTheme.getState().load();
  }, []);
  useEffect(() => {
    void useActivity.getState().load();
  }, []);

  // Vault-scoped: re-read on every vault change.
  useEffect(() => {
    if (vaultInfo) void useTagColors.getState().load();
  }, [vaultInfo]);
  useEffect(() => {
    if (vaultInfo) void useKanbanTags.getState().load();
  }, [vaultInfo]);
  useEffect(() => {
    if (vaultInfo) void useVaultTags.getState().load();
  }, [vaultInfo]);
  useEffect(() => {
    if (vaultInfo) void useFolderViews.getState().load();
  }, [vaultInfo]);
  useEffect(() => {
    if (vaultInfo) void useTemplates.getState().refresh();
  }, [vaultInfo]);
  useEffect(() => {
    if (vaultInfo) void useFolderGroups.getState().load();
  }, [vaultInfo]);
}
