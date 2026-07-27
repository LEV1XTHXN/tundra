import { calendar, config } from "@/services";
import type { FolderViews } from "./folderViews";

/**
 * One-time rewrites of colours already persisted in a vault, run at vault open.
 *
 * `TAG_PALETTE` is the palette every picker offers, but a *chosen* colour is
 * stored as a literal hex — on a tag, a folder-table select option, or a
 * calendar event. So changing the palette only affects future picks: everything
 * already coloured keeps its old hex and the vault ends up visibly mixed. This
 * module closes that gap by mapping the superseded hexes onto their successors.
 *
 * Three surfaces hold a palette hex, and they're all covered here:
 *
 * | Surface | Where it lives | Owner |
 * | --- | --- | --- |
 * | tag colours (incl. Kanban column colours, which write through to the tag) | `.vault/config/tag-colors.json` | frontend config passthrough |
 * | folder-table `select` / `multiSelect` options | `.vault/config/folder-views.json` | frontend config passthrough |
 * | calendar events | `.vault/config/calendar.json` | Rust core (`CalendarStore`) |
 *
 * The two config files are rewritten here because those files are wholly
 * frontend-owned already (see `tagColors.ts` / `folderViews.ts`). Events are
 * core data, so they go through a Rust command — `calendar.recolorEvents` — which
 * applies the same map atomically under the store's lock.
 */

/** Vault-scoped file recording which migrations have already run. */
const CONFIG_NAME = "migrations";

interface Migrations {
  /** Ids of every migration already applied to this vault. */
  applied?: string[];
}

/**
 * The palette swap: the original saturated primaries → the pastel set that
 * replaced them, hue for hue.
 *
 * **Both sides are frozen literals on purpose.** It would be tempting to derive
 * the target from `TAG_PALETTE[i]`, but a migration records something that
 * happened once; if the palette is ever retuned again, *this* migration must
 * keep producing the colours it produced the day it shipped, and the retune gets
 * its own entry below. Deriving would silently rewrite history for any vault
 * that hadn't opened yet.
 *
 * Keys must be lowercase — the Rust side lowercases the stored colour before
 * looking it up, and {@link remapHex} does the same.
 */
const PASTEL_REMAP: Record<string, string> = {
  "#ef4444": "#f69b94", // red
  "#f97316": "#eea471", // orange
  "#eab308": "#d3b460", // amber
  "#22c55e": "#85cb8f", // green
  "#14b8a6": "#50cec9", // teal
  "#3b82f6": "#7dbdfa", // blue
  "#8b5cf6": "#bda9f6", // violet
  "#ec4899": "#ed9ac1", // pink
};

/** Stable id for the pastel swap, recorded in `migrations.json` once applied. */
const PASTEL_MIGRATION_ID = "palette-pastel-1";

/** Map one hex through `remap`, or return it untouched. Case-insensitive on the
 *  input (a hand-edited config may hold `#EF4444`); the output is whatever the
 *  map supplies. */
function remapHex(hex: string, remap: Record<string, string>): string {
  return remap[hex.toLowerCase()] ?? hex;
}

/** Rewrite `tag-colors.json` in place. Returns how many tags changed. */
async function migrateTagColors(remap: Record<string, string>): Promise<number> {
  const colors = await config.read<Record<string, string>>("tag-colors");
  if (!colors) return 0;

  let changed = 0;
  const next: Record<string, string> = {};
  for (const [tag, hex] of Object.entries(colors)) {
    const mapped = remapHex(hex, remap);
    if (mapped !== hex) changed += 1;
    next[tag] = mapped;
  }

  if (changed > 0) await config.write("tag-colors", next);
  return changed;
}

/** Rewrite the `select` / `multiSelect` option colours in `folder-views.json`.
 *  Returns how many options changed. */
async function migrateFolderViews(remap: Record<string, string>): Promise<number> {
  const views = await config.read<FolderViews>("folder-views");
  if (!views) return 0;

  let changed = 0;
  const next: FolderViews = {};
  for (const [path, view] of Object.entries(views)) {
    // Only `properties[].options[].color` holds a palette hex; everything else
    // in a FolderView (sort, columns, widths, icon) is copied through as-is.
    next[path] = {
      ...view,
      properties: view.properties?.map((prop) => ({
        ...prop,
        options: prop.options?.map((option) => {
          const mapped = remapHex(option.color, remap);
          if (mapped !== option.color) changed += 1;
          return { ...option, color: mapped };
        }),
      })),
    };
  }

  if (changed > 0) await config.write("folder-views", next);
  return changed;
}

/**
 * Apply any not-yet-applied colour migrations to the open vault.
 *
 * Call once per vault open, and **before** `useTagColors` / `useFolderViews`
 * load — a store that read the pre-migration file would hold stale colours and
 * clobber the migrated file on its next write.
 *
 * Safe to run more than once: after a pass, no stored colour is a key in the map
 * any more, so a repeat run changes nothing. That's what makes the "record the
 * marker last" ordering below correct — if the app dies mid-migration the marker
 * is never written, and the next open simply finishes the job.
 *
 * Failures are swallowed by design. A migration that can't complete (vault
 * closed mid-open, unreadable config) must not stop the vault from opening; the
 * marker stays unwritten, so the next open retries.
 */
export async function migrateVaultPalette(): Promise<void> {
  try {
    const state = (await config.read<Migrations>(CONFIG_NAME)) ?? {};
    const applied = new Set(state.applied ?? []);
    if (applied.has(PASTEL_MIGRATION_ID)) return;

    await migrateTagColors(PASTEL_REMAP);
    await migrateFolderViews(PASTEL_REMAP);
    await calendar.recolorEvents(PASTEL_REMAP);

    applied.add(PASTEL_MIGRATION_ID);
    await config.write(CONFIG_NAME, { ...state, applied: [...applied] } satisfies Migrations);
  } catch {
    // Intentionally silent — see the doc comment. The next vault open retries.
  }
}

/** Exported for tests. */
export const __testing = {
  PASTEL_REMAP,
  PASTEL_MIGRATION_ID,
  remapHex,
  migrateTagColors,
  migrateFolderViews,
};
