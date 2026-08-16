/**
 * The nav tree's expansion is now a persisted file, so the things worth pinning
 * down are that it round-trips through vault config (the whole point: the tree
 * looks the same after a relaunch) and that a folder rename/move/delete keeps
 * the stored paths honest — a stale path is both a re-collapsed folder and
 * junk that would accumulate in the config file forever.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** In-memory stand-in for `.vault/config/*.json`. */
let store: Record<string, unknown> = {};

vi.mock("@/services", () => ({
  config: {
    read: vi.fn(async (name: string) => store[name] ?? null),
    write: vi.fn(async (name: string, value: unknown) => {
      store[name] = value;
      return null;
    }),
  },
}));

const { useWorkspace } = await import("./workspace");

/** The paths currently on "disk", sorted for stable comparison. */
const stored = () =>
  [...((store["workspace"] as { expandedFolders: string[] } | undefined)?.expandedFolders ?? [])].sort();

/** The paths currently in the store, sorted. */
const live = () => [...useWorkspace.getState().expandedFolders].sort();

beforeEach(() => {
  store = {};
  useWorkspace.setState({ expandedFolders: new Set(), loaded: false });
});

describe("workspace expansion", () => {
  it("survives a reload: what was expanded is expanded again", async () => {
    const ws = useWorkspace.getState();
    await ws.toggleFolder("Biology");
    await ws.toggleFolder("Biology/Cells");
    expect(stored()).toEqual(["Biology", "Biology/Cells"]);

    // Relaunch: fresh store, same config file.
    useWorkspace.setState({ expandedFolders: new Set(), loaded: false });
    await useWorkspace.getState().load();
    expect(live()).toEqual(["Biology", "Biology/Cells"]);
    expect(useWorkspace.getState().loaded).toBe(true);
  });

  it("toggles back off and expandFolder is idempotent", async () => {
    const ws = useWorkspace.getState();
    await ws.toggleFolder("Work");
    await ws.toggleFolder("Work");
    expect(stored()).toEqual([]);

    await ws.expandFolder("Work");
    await ws.expandFolder("Work");
    expect(stored()).toEqual(["Work"]);
  });

  it("starts empty when the vault has no workspace config", async () => {
    await useWorkspace.getState().load();
    expect(live()).toEqual([]);
  });

  it("follows a renamed folder, descendants included", async () => {
    const ws = useWorkspace.getState();
    await ws.toggleFolder("Biology");
    await ws.toggleFolder("Biology/Cells");
    await ws.toggleFolder("Work");

    await ws.renameFolder("Biology", "Bio");
    expect(stored()).toEqual(["Bio", "Bio/Cells", "Work"]);
  });

  it("follows a folder moved under another folder", async () => {
    const ws = useWorkspace.getState();
    await ws.toggleFolder("Cells");
    await ws.toggleFolder("Cells/Mitochondria");

    await ws.renameFolder("Cells", "Biology/Cells");
    expect(stored()).toEqual(["Biology/Cells", "Biology/Cells/Mitochondria"]);
  });

  it("does not touch a sibling whose name merely starts with the renamed one", async () => {
    const ws = useWorkspace.getState();
    await ws.toggleFolder("Bio");
    await ws.toggleFolder("Biology");

    await ws.renameFolder("Bio", "Chem");
    expect(stored()).toEqual(["Biology", "Chem"]);
  });

  it("forgets a deleted folder and everything under it", async () => {
    const ws = useWorkspace.getState();
    await ws.toggleFolder("Biology");
    await ws.toggleFolder("Biology/Cells");
    await ws.toggleFolder("Biological"); // prefix look-alike, must survive

    await ws.dropFolder("Biology");
    expect(stored()).toEqual(["Biological"]);
  });
});
