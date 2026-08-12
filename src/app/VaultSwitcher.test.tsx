// @vitest-environment jsdom
/**
 * The switcher's trash icon is the app's single most destructive control: it
 * moves a whole vault folder to the OS trash. So the wiring worth pinning is
 * the safety around it — that nothing reaches the service until the user
 * confirms, that the dialog names the exact folder being removed, and that the
 * currently open vault is deletable too (it used to be the one row without a
 * button, back when this action only edited a list).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { VaultInfo } from "@/services";
import "@/i18n";

vi.mock("@/services", () => ({
  pickVaultFolder: vi.fn(async () => null),
  vault: { listKnown: vi.fn(async () => []), delete: vi.fn(async () => false) },
}));

const { VaultSwitcher } = await import("./VaultSwitcher");
const { useKnownVaults } = await import("@/store/knownVaults");

const OPEN: VaultInfo = { name: "Work", path: "/home/u/Vaults/Work" };
const OTHER: VaultInfo = { name: "Personal", path: "/home/u/Vaults/Personal" };

afterEach(() => {
  cleanup();
  useKnownVaults.setState({ vaults: [], loaded: false });
});

/** Render the switcher with both vaults listed and its popover already open. */
function openSwitcher() {
  const onDelete = vi.fn(async () => {});
  useKnownVaults.setState({ vaults: [OPEN, OTHER], loaded: true });
  render(
    <VaultSwitcher
      vaultInfo={OPEN}
      onSwitch={vi.fn(async () => {})}
      onDelete={onDelete}
      onError={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByTitle(OPEN.path));
  return onDelete;
}

describe("VaultSwitcher vault deletion", () => {
  it("confirms before deleting, and passes the chosen vault's path", async () => {
    const onDelete = openSwitcher();

    fireEvent.click(await screen.findByLabelText(`Delete the vault ${OTHER.name}`));
    expect(onDelete).not.toHaveBeenCalled();

    // The dialog has to name the folder: this removes a directory from disk,
    // and two vaults can share a display name.
    await screen.findByText(`Delete “${OTHER.name}”?`);
    expect(screen.getByText(OTHER.path)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete vault" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(OTHER.path));
  });

  it("deletes nothing when the confirmation is cancelled", async () => {
    const onDelete = openSwitcher();

    fireEvent.click(await screen.findByLabelText(`Delete the vault ${OTHER.name}`));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByText(`Delete “${OTHER.name}”?`)).toBeNull());
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("can delete the vault that is currently open, and says so", async () => {
    const onDelete = openSwitcher();

    fireEvent.click(await screen.findByLabelText(`Delete the vault ${OPEN.name}`));
    await screen.findByText(/return to the welcome screen/);

    fireEvent.click(screen.getByRole("button", { name: "Delete vault" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(OPEN.path));
  });
});
