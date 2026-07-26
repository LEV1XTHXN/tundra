/**
 * Home dashboard widgets (Phase 2 step 6). Each is a self-contained component
 * that reads its own data through `services` — Pinned and Recent list notes,
 * Quick capture appends to the quick-note scratchpad. They refetch when
 * `refreshKey` changes (the vault's notes changed). React renders; data via
 * services only.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
  type Locale,
} from "date-fns";
import { ChevronLeft, ChevronRight, Flame } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { calendar, config, notes, quickNote, search, tags as tagsService } from "@/services";
import type { Block, NoteSummary, SearchHit } from "@/services";
import { NoteIcon } from "@/nav/NoteIcon";
import { useViewState } from "@/store/viewState";
import { useTheme } from "@/store/theme";
import { useActivity } from "@/store/activity";
import { useFolderGroups } from "@/store/folderGroups";
import { useDateLocale } from "@/i18n/dateLocale";
import { localizeError } from "@/i18n/errors";

const WEEK_STARTS_ON = 1;

function formatModified(iso: string, locale: Locale | undefined, t: TFunction): string {
  try {
    return t("nav.editedAt", { date: format(parseISO(iso), "MMM d, yyyy, h:mm a", { locale }) });
  } catch {
    return iso;
  }
}

export interface WidgetProps {
  vaultPath: string;
  /** Bumps when the vault's notes change, so widgets refetch. */
  refreshKey: unknown;
  onOpenNote: (id: string) => void;
  onError: (message: string) => void;
}

function NoteList({
  items,
  vaultPath,
  onOpenNote,
  empty,
}: {
  items: NoteSummary[];
  vaultPath: string;
  onOpenNote: (id: string) => void;
  empty: string;
}) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const showModifiedOnHover = useTheme((s) => s.showModifiedOnHover);
  if (items.length === 0) return <p className="widget-empty muted">{empty}</p>;
  return (
    <div className="home-note-list">
      {items.map((n) => (
        <button
          key={n.id}
          className="home-note-row"
          onClick={() => onOpenNote(n.id)}
          title={showModifiedOnHover ? formatModified(n.modified, dateLocale, t) : undefined}
        >
          <NoteIcon icon={n.icon} vaultPath={vaultPath} className="h-4 w-4" />
          <span className="home-note-title">{n.title || t("common.untitled")}</span>
        </button>
      ))}
    </div>
  );
}

/** Notes flagged `meta.pinned` (pin/unpin from the editor's pin button). */
export function PinnedWidget({ vaultPath, refreshKey, onOpenNote }: WidgetProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<NoteSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    notes
      .list()
      .then((l) => {
        if (!cancelled) setItems(l.filter((n) => n.pinned));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);
  return (
    <NoteList
      items={items}
      vaultPath={vaultPath}
      onOpenNote={onOpenNote}
      empty={t("home.pinnedEmpty")}
    />
  );
}

/** The most recently modified notes (`list_notes` is already modified-desc). */
export function RecentWidget({ vaultPath, refreshKey, onOpenNote }: WidgetProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<NoteSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    notes
      .list()
      .then((l) => {
        if (!cancelled) setItems(l.slice(0, 8));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);
  return <NoteList items={items} vaultPath={vaultPath} onOpenNote={onOpenNote} empty={t("home.recentEmpty")} />;
}

const SEARCH_RESULT_LIMIT = 12;
const SEARCH_DEBOUNCE_MS = 150;

/** Inline global search, right on Home — the non-dialog twin of the F2
 *  `SearchPalette`. Shares the same backend search: full text via
 *  `search.query`, and a leading `#` switches to tag search (`search.byTag`),
 *  same as the palette. Click a hit to open it (`onOpenNote`). */
export function SearchWidget({ onOpenNote }: WidgetProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setHits([]);
      return;
    }
    // `#tag` mode: a leading `#` searches by tag instead of full text; a bare
    // `#` with no tag yet shows nothing rather than every note.
    const isTagSearch = trimmed.startsWith("#");
    const tagQuery = trimmed.slice(1).trim();
    if (isTagSearch && !tagQuery) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const request = isTagSearch
        ? search.byTag(tagQuery, SEARCH_RESULT_LIMIT)
        : search.query(trimmed, SEARCH_RESULT_LIMIT);
      void request
        .then((results) => {
          if (!cancelled) setHits(results);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const trimmed = query.trim();
  return (
    <div className="search-widget">
      <input
        className="search-widget-input"
        type="text"
        value={query}
        placeholder={t("home.searchPlaceholder")}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="search-widget-results">
        {hits.length === 0 ? (
          <p className="widget-empty muted">
            {trimmed ? t("home.searchNoResults") : t("home.searchTypeToSearch")}
          </p>
        ) : (
          hits.map((hit) => (
            <button
              key={hit.id}
              className="home-note-row search-widget-row"
              onClick={() => onOpenNote(hit.id)}
            >
              <div className="search-hit">
                <span className="search-hit-title">{hit.title || t("common.untitled")}</span>
                {hit.snippet && <span className="search-hit-snippet">{hit.snippet}</span>}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/** Jot a thought straight into the quick-note scratchpad without leaving Home. */
export function QuickCaptureWidget({ onError }: WidgetProps) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "saved">("idle");

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      const note = await quickNote.read();
      const block: Block = {
        id: crypto.randomUUID(),
        type: "paragraph",
        content: [{ type: "text", text: trimmed, styles: {} }],
      };
      await quickNote.save({ ...note, blocks: [...(note.blocks ?? []), block] });
      setText("");
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1500);
    } catch (e) {
      onError(localizeError(e, t));
    }
  };

  return (
    <div className="quick-capture">
      <textarea
        className="quick-capture-input"
        value={text}
        placeholder={t("home.quickCapturePlaceholder")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="quick-capture-actions">
        <span className="muted">{status === "saved" ? t("home.addedToQuickNotes") : t("home.ctrlEnterToAdd")}</span>
        <button className="new-note" onClick={() => void submit()} disabled={!text.trim()}>
          {t("home.add")}
        </button>
      </div>
    </div>
  );
}

/** A compact month calendar: navigate months locally, click a day to jump the
 * full Calendar view there (`openCalendarOn`). Days carrying an event or a
 * note-date link get a dot indicator, fetched the same way CalendarView's own
 * grid does (`calendar.range` over the visible month). */
export function CalendarWidget({}: WidgetProps) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const openCalendarOn = useViewState((s) => s.openCalendarOn);
  const [cursor, setCursor] = useState(() => new Date());
  const [marked, setMarked] = useState<Set<string>>(new Set());

  const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: WEEK_STARTS_ON });
  const gridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: WEEK_STARTS_ON });
  const gridStartKey = format(gridStart, "yyyy-MM-dd");
  const gridEndKey = format(gridEnd, "yyyy-MM-dd");
  const gridDays = useMemo(
    () => eachDayOfInterval({ start: gridStart, end: gridEnd }),
    [gridStartKey, gridEndKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const weeks = gridDays.length / 7;
  // Locale-correct short weekday labels (e.g. "Mo"/"Пн"/"Mo") for the header
  // row, derived from the same week-start days rather than a hardcoded
  // English array.
  const weekdayLabels = useMemo(
    () => Array.from({ length: 7 }, (_, i) => format(addDays(gridStart, i), "EEEEEE", { locale: dateLocale })),
    [gridStartKey, dateLocale], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Size day cells to a square that fits BOTH the available width and height —
  // whichever is the limiting dimension — so cells stay square yet the whole
  // month is always visible without scrolling, at any widget size.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [cell, setCell] = useState(0);
  const weeksRef = useRef(weeks);
  weeksRef.current = weeks;
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const size = Math.min(el.clientWidth / 7, el.clientHeight / weeksRef.current);
      setCell(Math.max(0, Math.floor(size)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (el) setCell(Math.max(0, Math.floor(Math.min(el.clientWidth / 7, el.clientHeight / weeks))));
  }, [weeks]);

  useEffect(() => {
    let cancelled = false;
    calendar
      .range(gridStartKey, gridEndKey)
      .then((r) => {
        if (cancelled) return;
        const next = new Set<string>();
        for (const ev of r.events) {
          const start = startOfDay(parseISO(ev.start));
          const end = ev.end ? startOfDay(parseISO(ev.end)) : start;
          for (const d of eachDayOfInterval({ start, end })) next.add(format(d, "yyyy-MM-dd"));
        }
        for (const nd of r.note_dates) next.add(nd.date);
        setMarked(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gridStartKey, gridEndKey]);

  return (
    <div className="mini-calendar">
      <div className="mini-calendar-header">
        <button onClick={() => setCursor((c) => subMonths(c, 1))} aria-label={t("home.previousMonth")}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="mini-calendar-month">{format(cursor, "MMMM yyyy", { locale: dateLocale })}</span>
        <button onClick={() => setCursor((c) => addMonths(c, 1))} aria-label={t("home.nextMonth")}>
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mini-calendar-weekdays" style={{ gridTemplateColumns: `repeat(7, ${cell}px)` }}>
        {weekdayLabels.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>
      <div
        className="mini-calendar-grid"
        ref={gridRef}
        style={{ gridTemplateColumns: `repeat(7, ${cell}px)`, gridAutoRows: `${cell}px` }}
      >
        {gridDays.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dim = !isSameMonth(day, cursor);
          return (
            <button
              key={key}
              className={`mini-calendar-day${dim ? " dim" : ""}${isToday(day) ? " today" : ""}${marked.has(key) ? " has-events" : ""}`}
              onClick={() => openCalendarOn(day)}
              title={format(day, "EEEE, MMM d, yyyy", { locale: dateLocale })}
            >
              <span className="mini-calendar-daynum">{format(day, "d")}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Vault size at a glance: note/tag/group counts. Groups (sidebar folder
 *  groupings, `store/folderGroups.ts`) are frontend-only UI state, so their
 *  count comes straight from that store rather than a service call. */
export function StorageWidget({ refreshKey }: WidgetProps) {
  const { t } = useTranslation();
  const [noteCount, setNoteCount] = useState<number | null>(null);
  const [tagCount, setTagCount] = useState<number | null>(null);
  const groupCount = useFolderGroups((s) => s.groups.length);

  useEffect(() => {
    let cancelled = false;
    notes
      .list()
      .then((l) => {
        if (!cancelled) setNoteCount(l.length);
      })
      .catch(() => {});
    tagsService
      .list()
      .then((l) => {
        if (!cancelled) setTagCount(l.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <div className="storage-stats">
      <div className="storage-stat">
        <span className="storage-stat-value">{noteCount ?? "–"}</span>
        <span className="storage-stat-label">{t("home.notes")}</span>
      </div>
      <div className="storage-stat">
        <span className="storage-stat-value">{tagCount ?? "–"}</span>
        <span className="storage-stat-label">{t("home.tags")}</span>
      </div>
      <div className="storage-stat">
        <span className="storage-stat-value">{groupCount}</span>
        <span className="storage-stat-label">{t("home.groups")}</span>
      </div>
    </div>
  );
}

/** Consecutive-day usage streak (`store/activity.ts`) — extended on every note
 *  / quick-note save, so it reflects both "the app was open" and "a note was
 *  edited" that day. Loaded once at app boot; this widget only reads it. */
export function StreakWidget({}: WidgetProps) {
  const { t } = useTranslation();
  const currentStreak = useActivity((s) => s.currentStreak);
  const loaded = useActivity((s) => s.loaded);
  return (
    <div className="streak-widget">
      <Flame className="streak-icon h-8 w-8" />
      <span className="streak-count">{loaded ? currentStreak : "–"}</span>
      <span className="streak-label">{t("home.streakLabel", { count: currentStreak })}</span>
    </div>
  );
}

const CLOCK_CONFIG_FILE = "home-clock.json";

interface ClockConfig {
  format24h: boolean;
}

/** Local time + date, no network. Deliberately self-contained: it reads and
 *  persists its OWN tiny vault-config file rather than routing its one
 *  setting (12h/24h) through `Home`'s widget config, so adding the next
 *  widget with its own settings never means teaching `Home` a new shape —
 *  same pattern every other widget already follows for its data (Pinned/
 *  Recent call `notes.list()` directly, Calendar calls `calendar.range()`
 *  directly, etc.). */
export function ClockWidget({}: WidgetProps) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [now, setNow] = useState(() => new Date());
  const [format24h, setFormat24h] = useState(true);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    config
      .read<ClockConfig>(CLOCK_CONFIG_FILE)
      .then((cfg) => {
        if (!cancelled && cfg) setFormat24h(cfg.format24h);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleFormat = () => {
    const next = !format24h;
    setFormat24h(next);
    void config.write(CLOCK_CONFIG_FILE, { format24h: next } satisfies ClockConfig);
  };

  return (
    <div className="clock-widget">
      <span className="clock-time">{format(now, format24h ? "HH:mm:ss" : "h:mm:ss a", { locale: dateLocale })}</span>
      <span className="clock-date">{format(now, "EEEE, MMMM d, yyyy", { locale: dateLocale })}</span>
      <button className="clock-format-toggle" onClick={toggleFormat} title={t("home.toggleClockFormat")}>
        {format24h ? "24h" : "12h"}
      </button>
    </div>
  );
}

