/**
 * Home dashboard widgets (Phase 2 step 6). Each is a self-contained component
 * that reads its own data through `services` — Pinned and Recent list notes,
 * Quick capture appends to the quick-note scratchpad. They refetch when
 * `refreshKey` changes (the vault's notes changed). React renders; data via
 * services only.
 */
import { useEffect, useState } from "react";
import { format, parseISO, type Locale } from "date-fns";
import { Flame } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { config, kanban, notes, quickNote, search, tags as tagsService } from "@/services";
import type { Block, KanbanBoard, NoteSummary, SearchHit } from "@/services";
import { MiniMonth } from "@/calendar/MiniMonth";
import { NoteIcon } from "@/nav/NoteIcon";
import { useViewState } from "@/store/viewState";
import { useTheme } from "@/store/theme";
import { useActivity } from "@/store/activity";
import { useTagColors } from "@/store/tagColors";
import { useDateLocale } from "@/i18n/dateLocale";
import { localizeError } from "@/i18n/errors";

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
 * full Calendar view there (`openCalendarOn`). The month itself is `MiniMonth`
 * — shared with the Calendar view's sidebar — so this widget is just its
 * cursor plus the click destination. */
export function CalendarWidget({}: WidgetProps) {
  const openCalendarOn = useViewState((s) => s.openCalendarOn);
  const [cursor, setCursor] = useState(() => new Date());

  return <MiniMonth cursor={cursor} onCursorChange={setCursor} onSelectDay={openCalendarOn} />;
}

/** Vault size at a glance: notes, tags, and the current usage streak. The third
 *  slot used to be the folder-group count, which measured a sidebar convenience
 *  rather than the vault; the streak is the number people actually look for
 *  here, and the standalone Streak widget stays for anyone who wants it big. */
export function StorageWidget({ refreshKey }: WidgetProps) {
  const { t } = useTranslation();
  const [noteCount, setNoteCount] = useState<number | null>(null);
  const [tagCount, setTagCount] = useState<number | null>(null);
  const currentStreak = useActivity((s) => s.currentStreak);
  const streakLoaded = useActivity((s) => s.loaded);

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
        <span className="storage-stat-value">{streakLoaded ? currentStreak : "–"}</span>
        <span className="storage-stat-label">{t("home.dayStreak")}</span>
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

/**
 * A Kanban board at a glance: each column with its tag colour, its count, and
 * the first couple of notes in it. Shows the vault's first board — a Home card
 * is a summary, and "which board" is a choice the Kanban view itself exists to
 * make.
 *
 * One `kanban.boards()` call is enough: a column already carries its ordered
 * `note_ids`, so the counts need no second query. Titles come from the note
 * summaries the shell has already loaded.
 */
export function BoardWidget({ refreshKey, onOpenNote }: WidgetProps) {
  const { t } = useTranslation();
  const [board, setBoard] = useState<KanbanBoard | null>(null);
  const [titles, setTitles] = useState<Map<string, NoteSummary>>(new Map());
  const setView = useViewState((s) => s.setView);
  const tagColors = useTagColors((s) => s.colors);

  useEffect(() => {
    let cancelled = false;
    Promise.all([kanban.boards(), notes.list()])
      .then(([boards, list]) => {
        if (cancelled) return;
        setBoard(boards[0] ?? null);
        setTitles(new Map(list.map((n) => [n.id, n])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (!board || board.columns.length === 0) {
    return <p className="widget-empty muted">{t("home.widgets.board.empty")}</p>;
  }

  return (
    <div className="board-widget">
      <button className="board-widget-name" onClick={() => setView("kanban")}>
        {board.name}
      </button>
      <div className="board-widget-columns">
        {board.columns.map((col) => (
          <div key={col.id} className="board-widget-column">
            <div className="board-widget-column-head">
              <span
                className="board-widget-dot"
                style={col.tag && tagColors[col.tag] ? { background: tagColors[col.tag] } : undefined}
              />
              <span className="board-widget-column-name">{col.name}</span>
              <span className="board-widget-count">{col.note_ids.length}</span>
            </div>
            {col.note_ids.slice(0, 2).map((id) => (
              <button key={id} className="board-widget-card" onClick={() => onOpenNote(id)}>
                {titles.get(id)?.title || t("common.untitled")}
              </button>
            ))}
          </div>
        ))}
      </div>
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

