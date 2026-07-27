//! Calendar: a first-class event store plus note→date links (Phase 3 step 1).
//!
//! Two sources of calendar data, combined by [`range_query`]:
//! - **Events** are standalone records (including multi-day time periods) owned
//!   here and persisted to a dedicated in-vault file (`.vault/config/calendar.json`)
//!   via the vault's atomic `write_config` — it is *content*, so it is backed up
//!   and MAY sync, and is deliberately NOT under `.vault/cache/`.
//! - **Note→date links** live on the note itself ([`NoteMeta::dates`]) and are
//!   mirrored into `NoteSummary` + the in-memory index exactly like `pinned`, so a
//!   range query is served from the index without re-reading note files.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;

use crate::document::Icon;
use crate::error::Result;
use crate::vault::Vault;

/// The in-vault file (under `.vault/config/`) holding the event store. Content,
/// not cache — included in backups and MAY sync.
const CALENDAR_FILE: &str = "calendar.json";

/// A note→date link stored on the note (`NoteMeta::dates`). A bare date, plus an
/// optional `event_id` when the link is to a specific event rather than just a day.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct NoteDate {
    pub date: NaiveDate,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,
}

/// The unit a repeat counts in. "Daily", "weekly" and "yearly" are `interval: 1`
/// of the matching unit; a user-defined span of N days is `Day` with `interval: N`
/// — one shape rather than a separate "custom" variant that would need its own
/// expansion branch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum RepeatUnit {
    Day,
    Week,
    Year,
}

/// How an event repeats. Attached to the ONE stored event (the series anchor);
/// the individual occurrences are never written to disk — [`CalendarStore::events_in_range`]
/// expands them per query, which is what keeps an open-ended series finite.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct Repeat {
    pub unit: RepeatUnit,
    /// Every N units. Clamped to >= 1 on write: a 0 would step nowhere and spin
    /// the expansion loop forever.
    pub interval: u32,
    /// The last day that may carry an occurrence; `None` means the series runs
    /// indefinitely (which costs nothing — expansion is bounded by the query).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<NaiveDate>,
    /// Occurrence days the user deleted one at a time. Kept sorted and unique.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skip: Vec<NaiveDate>,
}

/// A first-class calendar event. A single day/instant when `end` is `None`; a
/// multi-day time period when `end` is set. Times are stored in UTC; `all_day`
/// tells the UI to render the day span and ignore the clock time. (Range overlap
/// is computed on the UTC calendar date — a local-timezone refinement can come
/// later without changing the on-disk shape.)
///
/// With `repeat` set the record is a *series anchor* rather than a single entry:
/// a range query returns one clone per occurrence, each carrying the day it falls
/// on in `occurrence`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct Event {
    pub id: String,
    pub title: String,
    pub start: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<DateTime<Utc>>,
    #[serde(default)]
    pub all_day: bool,
    /// Notes linked to this event (optional; the reciprocal of a `NoteDate` whose
    /// `event_id` points here).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub note_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// How the event repeats, if it does.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repeat: Option<Repeat>,
    /// The day THIS instance of a repeating event starts on. Set only on the
    /// clones a range query expands, and stripped again on the way back in
    /// (`normalize`) — it is an annotation about which occurrence the UI is
    /// holding, never part of the stored record. `None` on everything else,
    /// including the anchor as it sits on disk.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub occurrence: Option<NaiveDate>,
}

impl Event {
    /// The inclusive `[first, last]` calendar-day span the event occupies. A
    /// single-day event (no `end`) spans just its start day; `end` before `start`
    /// is tolerated by ordering the pair.
    fn day_span(&self) -> (NaiveDate, NaiveDate) {
        let start = self.start.date_naive();
        let end = self.end.map(|e| e.date_naive()).unwrap_or(start);
        if end < start {
            (end, start)
        } else {
            (start, end)
        }
    }

    /// Whether this event's day span overlaps the inclusive `[start, end]` range.
    fn overlaps(&self, start: NaiveDate, end: NaiveDate) -> bool {
        let (first, last) = self.day_span();
        first <= end && last >= start
    }

    /// This event moved wholesale to the occurrence beginning on `day`. Both
    /// instants shift by the same WHOLE number of days, so the clock time and the
    /// length of a multi-day period are carried over untouched.
    fn occurrence_on(&self, day: NaiveDate) -> Event {
        let shift = Duration::days((day - self.day_span().0).num_days());
        Event {
            start: self.start + shift,
            end: self.end.map(|e| e + shift),
            occurrence: Some(day),
            ..self.clone()
        }
    }
}

/// Every occurrence of a repeating `event` whose day span touches `[start, end]`.
///
/// The walk starts at the first occurrence that can still *reach* the range —
/// one whose first day is at most the event's own span before it — rather than at
/// the series anchor, so a daily event started years ago costs a division, not one
/// iteration per elapsed day.
fn expand(event: &Event, repeat: &Repeat, start: NaiveDate, end: NaiveDate) -> Vec<Event> {
    let (anchor, last) = event.day_span();
    let earliest = start - Duration::days((last - anchor).num_days());
    let interval = repeat.interval.max(1) as i64;
    let mut out = Vec::new();

    let mut take = |day: NaiveDate| {
        if day >= earliest && !repeat.skip.contains(&day) {
            out.push(event.occurrence_on(day));
        }
    };

    match repeat.unit {
        RepeatUnit::Day | RepeatUnit::Week => {
            let step = if repeat.unit == RepeatUnit::Week { interval * 7 } else { interval };
            let delta = (earliest - anchor).num_days();
            // Ceiling division, spelled out: `i64::div_ceil` is still unstable.
            let mut n = if delta <= 0 { 0 } else { (delta + step - 1) / step };
            loop {
                let Some(day) = anchor.checked_add_signed(Duration::days(n * step)) else {
                    break;
                };
                if day > end || repeat.until.is_some_and(|u| day > u) {
                    break;
                }
                take(day);
                n += 1;
            }
        }
        // Years aren't a fixed number of days, so this counts them instead of
        // stepping dates: `with_year` puts the anchor's month/day in the target
        // year, and simply has no answer for 29 Feb in a common year — that year
        // gets no occurrence rather than sliding to the 28th or the 1st.
        RepeatUnit::Year => {
            let years = (earliest.year() - anchor.year()) as i64;
            let mut k = if years <= 0 { 0 } else { (years + interval - 1) / interval };
            loop {
                let year = anchor.year() as i64 + k * interval;
                if year > end.year() as i64 {
                    break;
                }
                if let Some(day) = i32::try_from(year).ok().and_then(|y| anchor.with_year(y)) {
                    if day > end || repeat.until.is_some_and(|u| day > u) {
                        break;
                    }
                    take(day);
                }
                k += 1;
            }
        }
    }

    out
}

/// Bring an incoming event into the shape the store keeps: `occurrence` is a
/// query-time annotation and must never reach the file, and a repeat interval
/// below 1 would make expansion loop forever.
fn normalize(event: &mut Event) {
    event.occurrence = None;
    if let Some(repeat) = event.repeat.as_mut() {
        repeat.interval = repeat.interval.max(1);
        repeat.skip.sort_unstable();
        repeat.skip.dedup();
    }
}

/// Re-anchor an edit that was made on an expanded occurrence.
///
/// The dialog hands back the instants of the occurrence the user clicked, not the
/// series anchor's. Storing them verbatim would drag the whole series forward to
/// that day and silently drop every earlier occurrence, so the incoming times are
/// re-anchored: the clock time and the duration are the user's, while the start
/// DATE stays the stored one — shifted by however far the user moved this
/// occurrence's own date, which moves the entire series by the same amount.
///
/// Only applies while the event still repeats. Clearing the repeat on an
/// occurrence keeps that occurrence's day, which is the natural reading of
/// "make this one a plain event".
fn rebase_onto_series(incoming: &mut Event, stored: &Event) {
    let Some(occurrence) = incoming.occurrence else {
        return;
    };
    if incoming.repeat.is_none() {
        return;
    }
    let moved = (incoming.start.date_naive() - occurrence).num_days();
    let target = stored.start.date_naive() + Duration::days(moved);
    let shift = target - incoming.start.date_naive();
    incoming.start += shift;
    incoming.end = incoming.end.map(|e| e + shift);
    if moved != 0 {
        // The skipped days named occurrences of the OLD schedule; once it moves
        // they no longer land on one, and would hide unrelated days instead.
        if let Some(repeat) = incoming.repeat.as_mut() {
            repeat.skip.clear();
        }
    }
}

/// A note→date link surfaced by a range query, carrying just enough of the note's
/// summary (title/icon) to render and open it without a file read.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct NoteDateEntry {
    pub note_id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<Icon>,
    pub date: NaiveDate,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,
}

/// The combined answer to "what's on the calendar in this range": standalone
/// events and note→date links, both falling within `[start, end]`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CalendarRange {
    pub events: Vec<Event>,
    pub note_dates: Vec<NoteDateEntry>,
}

/// The event store for one open vault. Opened and held alongside the search/link
/// indexes (see the Tauri `AppState`), cheap to share via `Arc`. Events live in
/// memory behind a lock and are written through the vault's atomic `write_config`
/// on every mutation, so they survive crashes/backup/sync.
#[derive(Debug, Default)]
pub struct CalendarStore {
    events: RwLock<Vec<Event>>,
}

impl CalendarStore {
    /// Load the event store from `.vault/config/calendar.json`, or start empty if
    /// it doesn't exist yet.
    pub fn open(vault: &Vault) -> Result<Arc<Self>> {
        let events = match vault.read_config(CALENDAR_FILE)? {
            Some(raw) if !raw.trim().is_empty() => serde_json::from_str(&raw)?,
            _ => Vec::new(),
        };
        Ok(Arc::new(CalendarStore {
            events: RwLock::new(events),
        }))
    }

    /// All events, unordered.
    pub fn list(&self) -> Vec<Event> {
        self.events.read().unwrap().clone()
    }

    /// Events whose day span overlaps the inclusive `[start, end]` range —
    /// including multi-day periods that only partially fall inside it.
    ///
    /// A repeating event is returned once **per occurrence** in the range, each
    /// clone shifted onto its own day and tagged with `occurrence`. Callers get
    /// several events sharing one `id`, so anything keying on identity has to
    /// pair the id with the occurrence day.
    pub fn events_in_range(&self, start: NaiveDate, end: NaiveDate) -> Vec<Event> {
        let mut out = Vec::new();
        for event in self.events.read().unwrap().iter() {
            match &event.repeat {
                Some(repeat) => out.extend(expand(event, repeat, start, end)),
                None if event.overlaps(start, end) => out.push(event.clone()),
                None => {}
            }
        }
        out
    }

    /// Add an event (assigning a fresh UUID if `id` is empty) and persist.
    pub fn add(&self, vault: &Vault, mut event: Event) -> Result<Event> {
        if event.id.trim().is_empty() {
            event.id = Uuid::new_v4().to_string();
        }
        normalize(&mut event);
        {
            let mut events = self.events.write().unwrap();
            events.push(event.clone());
        }
        self.persist(vault)?;
        Ok(event)
    }

    /// Replace an existing event (matched by `id`) and persist. No-op-safe: an
    /// unknown id simply changes nothing.
    ///
    /// An edit made on one occurrence of a repeating event updates the whole
    /// series, re-anchored by [`rebase_onto_series`].
    pub fn update(&self, vault: &Vault, mut event: Event) -> Result<()> {
        {
            let mut events = self.events.write().unwrap();
            if let Some(slot) = events.iter_mut().find(|e| e.id == event.id) {
                rebase_onto_series(&mut event, slot);
                normalize(&mut event);
                *slot = event;
            } else {
                return Ok(());
            }
        }
        self.persist(vault)
    }

    /// Drop ONE occurrence of a repeating event: `date` joins the series' skip
    /// list, so expansion stops producing that day while the rest of the series
    /// stands. No-op-safe — an unknown id, a non-repeating event, or an
    /// already-skipped day changes nothing (and writes nothing).
    pub fn skip_occurrence(&self, vault: &Vault, id: &str, date: NaiveDate) -> Result<()> {
        {
            let mut events = self.events.write().unwrap();
            let Some(event) = events.iter_mut().find(|e| e.id == id) else {
                return Ok(());
            };
            let Some(repeat) = event.repeat.as_mut() else {
                return Ok(());
            };
            if repeat.skip.contains(&date) {
                return Ok(());
            }
            repeat.skip.push(date);
            repeat.skip.sort_unstable();
        }
        self.persist(vault)
    }

    /// Rewrite event colours through an `old hex → new hex` map, persisting only
    /// if something actually changed. Returns how many events were recoloured.
    ///
    /// Deliberately a *generic* remap rather than a palette-aware migration: the
    /// palette itself lives in TypeScript (`TAG_PALETTE`), and keeping a second
    /// copy of it here is exactly the drift the graph's `readPaletteColor` avoids.
    /// The caller supplies the mapping; the core just applies it atomically.
    ///
    /// Lookups are case-insensitive on the stored colour (map keys must be
    /// lowercase), so a hand-edited `calendar.json` written as `#EF4444` still
    /// matches. The stored value becomes exactly what the map supplies.
    pub fn recolor(&self, vault: &Vault, remap: &HashMap<String, String>) -> Result<usize> {
        let changed = {
            let mut events = self.events.write().unwrap();
            let mut changed = 0;
            for event in events.iter_mut() {
                let Some(current) = event.color.as_deref() else {
                    continue;
                };
                let Some(next) = remap.get(&current.to_ascii_lowercase()) else {
                    continue;
                };
                if next != current {
                    event.color = Some(next.clone());
                    changed += 1;
                }
            }
            changed
        };
        // No write when nothing matched — the common case once the migration has
        // run, and it keeps the file's mtime honest for backup/sync.
        if changed > 0 {
            self.persist(vault)?;
        }
        Ok(changed)
    }

    /// Delete an event by id and persist.
    pub fn delete(&self, vault: &Vault, id: &str) -> Result<()> {
        {
            let mut events = self.events.write().unwrap();
            events.retain(|e| e.id != id);
        }
        self.persist(vault)
    }

    /// Serialize the current events to the in-vault store file, atomically.
    fn persist(&self, vault: &Vault) -> Result<()> {
        let json = {
            let events = self.events.read().unwrap();
            serde_json::to_string_pretty(&*events)?
        };
        vault.write_config(CALENDAR_FILE, &json)
    }
}

/// Combine store events and note→date links falling within `[start, end]` into a
/// single answer. The note side is served from the vault's in-memory index (the
/// mirrored `NoteSummary::dates`), so this never re-reads note files.
pub fn range_query(
    vault: &Vault,
    store: &CalendarStore,
    start: NaiveDate,
    end: NaiveDate,
) -> CalendarRange {
    CalendarRange {
        events: store.events_in_range(start, end),
        note_dates: vault.notes_in_date_range(start, end),
    }
}


#[cfg(test)]
mod tests;
