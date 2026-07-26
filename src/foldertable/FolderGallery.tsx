/**
 * The folder "database"'s Gallery view (default) — a responsive card grid,
 * subfolders first, then notes. Each note card shows its icon, title, a
 * short content preview (fetched lazily — see below), and its colored
 * select/multiSelect property chips (the SAME chip styling/colors as the
 * List view's cells — `tagChipStyle`, not a new palette).
 *
 * Virtualized by ROW (a horizontal slice of `cols` cards), same technique as
 * the List view's `@tanstack/react-virtual` usage but with dynamic height
 * measurement (`measureElement`) — a card's height depends on its preview
 * text/chip count, which the fixed-row-height List view never had to deal
 * with. Card previews are fetched ONLY while a card is actually mounted
 * (i.e. in a rendered — or near-rendered, via overscan — virtual row) and
 * cached for the gallery's lifetime, so scrolling never re-fetches a note
 * already seen and opening a folder with hundreds of notes never reads
 * hundreds of note bodies up front.
 */
import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatDistanceToNow, parseISO, type Locale } from "date-fns";
import { Folder as FolderIcon, Pin } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { notes } from "@/services";
import { NoteIcon } from "@/nav/NoteIcon";
import { tagChipStyle } from "@/store/tagColors";
import type { PropertyDef } from "@/store/folderViews";
import { propertyValue, type TableRow } from "./ordering";
import { notePreview } from "./notePreview";
import { useDateLocale } from "@/i18n/dateLocale";
import { localizeError } from "@/i18n/errors";
import type { useFolderSchema } from "./useFolderSchema";

const CARD_MIN_WIDTH = 220; // px
const GRID_GAP = 14; // px
const ESTIMATED_ROW_HEIGHT = 190; // px — a starting guess; measureElement corrects it live

interface FolderGalleryProps {
  rows: TableRow[];
  schema: ReturnType<typeof useFolderSchema>;
  vaultPath: string;
  onOpenNote: (id: string) => void;
  onOpenFolder: (path: string) => void;
}

/** A small, stable hue per note id — gives every card's icon strip a distinct
 *  but consistent identity (same note, same color, every time) without
 *  storing anything. Blended into the theme's own card color in CSS
 *  (`color-mix`), so it stays readable in light AND dark regardless of hue. */
function accentHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

function formatModified(iso: string, locale: Locale | undefined, t: TFunction): string {
  try {
    return t("folderView.modified", { time: formatDistanceToNow(parseISO(iso), { addSuffix: true, locale }) });
  } catch {
    return t("folderView.modifiedUnknown");
  }
}

/** The folder's select/multiSelect properties currently shown as columns, in
 *  column order — what the gallery renders as chips (respects "hide column"
 *  the same way the List view does: hidden columns don't show as chips either). */
function chipDefs(schema: ReturnType<typeof useFolderSchema>): PropertyDef[] {
  return schema.columns
    .filter((c): c is { prop: string } => typeof c === "object")
    .map((c) => schema.propsById[c.prop])
    .filter((def): def is PropertyDef => !!def && (def.type === "select" || def.type === "multiSelect"));
}

function FolderCard({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <button className="gallery-card gallery-card-folder" onClick={onOpen}>
      <div className="gallery-card-strip gallery-card-strip-folder">
        <FolderIcon size={34} />
      </div>
      <div className="gallery-card-body">
        <div className="gallery-card-title">{name}</div>
      </div>
    </button>
  );
}

function NoteCard({
  row,
  vaultPath,
  defs,
  previewCache,
  onOpen,
  onError,
}: {
  row: Extract<TableRow, { kind: "note" }>;
  vaultPath: string;
  defs: PropertyDef[];
  previewCache: Map<string, string>;
  onOpen: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const s = row.summary;
  const [preview, setPreview] = useState<string | null>(previewCache.get(s.id) ?? null);

  useEffect(() => {
    if (preview !== null) return;
    let cancelled = false;
    notes
      .read(s.id)
      .then((note) => {
        if (cancelled) return;
        const text = notePreview(note.blocks);
        previewCache.set(s.id, text);
        setPreview(text);
      })
      .catch((e) => {
        if (cancelled) return;
        previewCache.set(s.id, "");
        setPreview("");
        onError(localizeError(e, t));
      });
    return () => {
      cancelled = true;
    };
    // Only the note id should re-trigger a fetch; `preview`'s own change (the
    // fetch's own result landing) must not loop back into re-fetching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.id]);

  const chips = defs
    .map((def) => ({ def, value: propertyValue(s, def.id) }))
    .filter((c): c is { def: PropertyDef; value: NonNullable<typeof c.value> } => c.value !== undefined);

  return (
    <button className="gallery-card" onClick={onOpen}>
      <div
        className="gallery-card-strip"
        style={{ ["--card-accent" as string]: `hsl(${accentHue(s.id)} 70% 55%)` }}
      >
        <NoteIcon icon={s.icon} vaultPath={vaultPath} className="h-10 w-10" />
        {row.pinned && <Pin size={13} className="gallery-card-pin" />}
      </div>
      <div className="gallery-card-body">
        <div className="gallery-card-title">{s.title || t("common.untitled")}</div>
        {preview ? (
          <p className="gallery-card-preview">{preview}</p>
        ) : preview === null ? (
          <p className="gallery-card-preview gallery-card-preview-loading">&nbsp;</p>
        ) : null}
        {chips.length > 0 && (
          <div className="gallery-card-chips">
            {chips.map(({ def, value }) =>
              value.type === "select" ? (
                <SelectChip key={def.id} def={def} id={value.value} />
              ) : value.type === "multiSelect" ? (
                value.value.map((id) => <SelectChip key={`${def.id}:${id}`} def={def} id={id} />)
              ) : null,
            )}
          </div>
        )}
      </div>
      <div className="gallery-card-footer muted">{formatModified(s.modified, dateLocale, t)}</div>
    </button>
  );
}

function SelectChip({ def, id }: { def: PropertyDef; id: string }) {
  const option = def.options?.find((o) => o.id === id);
  if (!option) return null;
  return (
    <span className="gallery-chip" style={tagChipStyle(option.color)}>
      {option.name}
    </span>
  );
}

export function FolderGallery({ rows, schema, vaultPath, onOpenNote, onOpenFolder }: FolderGalleryProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // The gallery's lifetime cache (this component instance = one folder, since
  // FolderTableView.tsx's `key={folderViewPath}` remounts on navigation) —
  // never re-fetched for a card already read once, including on scroll-back.
  const previewCache = useRef(new Map<string, string>());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const cols = width > 0 ? Math.max(1, Math.floor((width + GRID_GAP) / (CARD_MIN_WIDTH + GRID_GAP))) : 1;
  const rowCount = Math.ceil(rows.length / cols);
  const defs = chipDefs(schema);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 3,
  });

  if (rows.length === 0) {
    return <div className="ft-empty muted">This folder is empty.</div>;
  }

  return (
    <div ref={scrollRef} className="gallery-scroll">
      {error && <div className="gallery-error muted">{error}</div>}
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const start = item.index * cols;
          const cardsInRow = rows.slice(start, start + cols);
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="gallery-row"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${item.start}px)`,
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
              }}
            >
              {cardsInRow.map((row) =>
                row.kind === "folder" ? (
                  <FolderCard key={`f:${row.path}`} name={row.name} onOpen={() => onOpenFolder(row.path)} />
                ) : (
                  <NoteCard
                    key={`n:${row.summary.id}`}
                    row={row}
                    vaultPath={vaultPath}
                    defs={defs}
                    previewCache={previewCache.current}
                    onOpen={() => onOpenNote(row.summary.id)}
                    onError={(m) => setError(m)}
                  />
                ),
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
