/**
 * The palette migration rewrites colours that users already picked, in files
 * that are the user's own data — so the things worth pinning down are that it
 * touches exactly the superseded hexes (never a hand-picked one), that it runs
 * once and only once, and that a crash mid-way leaves the vault re-migratable
 * rather than half-done.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** In-memory stand-in for `.vault/config/*.json`. */
let store: Record<string, unknown> = {};
const recolorEvents = vi.fn(async (_remap: Record<string, string>) => 0);

vi.mock("@/services", () => ({
  config: {
    read: vi.fn(async (name: string) => store[name] ?? null),
    write: vi.fn(async (name: string, value: unknown) => {
      store[name] = value;
      return null;
    }),
  },
  calendar: { recolorEvents: (remap: Record<string, string>) => recolorEvents(remap) },
  // tagColors.ts (imported below for the palette tripwire) pulls these in.
  kanban: { boards: vi.fn(async () => []) },
  tags: { list: vi.fn(async () => []) },
}));

const { migrateVaultPalette, __testing } = await import("./paletteMigration");
const { TAG_PALETTE } = await import("./tagColors");
const { PASTEL_MIGRATION_ID, PASTEL_REMAP } = __testing;

beforeEach(() => {
  store = {};
  recolorEvents.mockClear();
  recolorEvents.mockImplementation(async () => 0);
});

describe("palette migration", () => {
  it("remaps superseded tag colours and leaves everything else alone", async () => {
    store["tag-colors"] = {
      biology: "#22c55e", // old green — migrates
      urgent: "#ef4444", // old red — migrates
      bespoke: "#123456", // never in any palette — untouched
      already: "#85cb8f", // already pastel — untouched
    };

    await migrateVaultPalette();

    expect(store["tag-colors"]).toEqual({
      biology: "#85cb8f",
      urgent: "#f69b94",
      bespoke: "#123456",
      already: "#85cb8f",
    });
  });

  it("remaps folder-table select options without disturbing the rest of the view", async () => {
    store["folder-views"] = {
      Recipes: {
        viewMode: "list",
        columnWidths: { name: 240 },
        properties: [
          {
            id: "p1",
            name: "Status",
            type: "select",
            options: [
              { id: "o1", name: "Done", color: "#22c55e" },
              { id: "o2", name: "Custom", color: "#abcdef" },
            ],
          },
          { id: "p2", name: "Notes", type: "text" }, // no options at all
        ],
      },
    };

    await migrateVaultPalette();

    const view = (store["folder-views"] as Record<string, any>)["Recipes"];
    expect(view.properties[0].options).toEqual([
      { id: "o1", name: "Done", color: "#85cb8f" },
      { id: "o2", name: "Custom", color: "#abcdef" },
    ]);
    expect(view.properties[1]).toEqual({ id: "p2", name: "Notes", type: "text" });
    // Untouched fields survive the rewrite — this rewrites the whole file.
    expect(view.viewMode).toBe("list");
    expect(view.columnWidths).toEqual({ name: 240 });
  });

  it("hands the same map to the calendar and records the marker", async () => {
    await migrateVaultPalette();

    expect(recolorEvents).toHaveBeenCalledWith(PASTEL_REMAP);
    expect(store["migrations"]).toEqual({ applied: [PASTEL_MIGRATION_ID] });
  });

  it("does not run twice", async () => {
    store["migrations"] = { applied: [PASTEL_MIGRATION_ID] };
    store["tag-colors"] = { urgent: "#ef4444" };

    await migrateVaultPalette();

    expect(recolorEvents).not.toHaveBeenCalled();
    // A colour that somehow survived is deliberately left alone on a later open:
    // the swap is a historical event, not a rule enforced forever.
    expect(store["tag-colors"]).toEqual({ urgent: "#ef4444" });
  });

  it("preserves markers from earlier migrations", async () => {
    store["migrations"] = { applied: ["something-older"] };

    await migrateVaultPalette();

    expect(store["migrations"]).toEqual({ applied: ["something-older", PASTEL_MIGRATION_ID] });
  });

  it("leaves the marker unwritten when a step fails, so the next open retries", async () => {
    recolorEvents.mockImplementation(async () => {
      throw new Error("vault closed");
    });
    store["tag-colors"] = { urgent: "#ef4444" };

    await expect(migrateVaultPalette()).resolves.toBeUndefined();
    expect(store["migrations"]).toBeUndefined();

    // The retry completes the job — the already-migrated tag is not double-mapped.
    recolorEvents.mockImplementation(async () => 0);
    await migrateVaultPalette();
    expect(store["tag-colors"]).toEqual({ urgent: "#f69b94" });
    expect(store["migrations"]).toEqual({ applied: [PASTEL_MIGRATION_ID] });
  });

  it("is a no-op on a vault with no colour config at all", async () => {
    await migrateVaultPalette();

    expect(store["tag-colors"]).toBeUndefined();
    expect(store["folder-views"]).toBeUndefined();
    expect(store["migrations"]).toEqual({ applied: [PASTEL_MIGRATION_ID] });
  });

  it("maps every old palette entry onto a distinct new one", () => {
    const targets = Object.values(PASTEL_REMAP);
    expect(Object.keys(PASTEL_REMAP)).toHaveLength(8);
    expect(new Set(targets).size).toBe(8);
    // No entry maps onto another entry's key, which would make a second pass
    // shift colours again rather than settle.
    for (const target of targets) expect(PASTEL_REMAP[target]).toBeUndefined();
  });

  /**
   * Tripwire, not a coupling. The migration's targets are frozen literals by
   * design, so if this fails it means TAG_PALETTE has moved on since the pastel
   * swap — which is fine, but it needs its OWN migration entry rather than an
   * edit to this one, or vaults that haven't opened yet get the wrong colours.
   */
  it("lands every migrated colour on the current palette", () => {
    expect(new Set(Object.values(PASTEL_REMAP))).toEqual(new Set(TAG_PALETTE));
  });
});
