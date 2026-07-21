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

use std::sync::{Arc, RwLock};

use chrono::{DateTime, NaiveDate, Utc};
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

/// A first-class calendar event. A single day/instant when `end` is `None`; a
/// multi-day time period when `end` is set. Times are stored in UTC; `all_day`
/// tells the UI to render the day span and ignore the clock time. (Range overlap
/// is computed on the UTC calendar date — a local-timezone refinement can come
/// later without changing the on-disk shape.)
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
    pub fn events_in_range(&self, start: NaiveDate, end: NaiveDate) -> Vec<Event> {
        self.events
            .read()
            .unwrap()
            .iter()
            .filter(|e| e.overlaps(start, end))
            .cloned()
            .collect()
    }

    /// Add an event (assigning a fresh UUID if `id` is empty) and persist.
    pub fn add(&self, vault: &Vault, mut event: Event) -> Result<Event> {
        if event.id.trim().is_empty() {
            event.id = Uuid::new_v4().to_string();
        }
        {
            let mut events = self.events.write().unwrap();
            events.push(event.clone());
        }
        self.persist(vault)?;
        Ok(event)
    }

    /// Replace an existing event (matched by `id`) and persist. No-op-safe: an
    /// unknown id simply changes nothing.
    pub fn update(&self, vault: &Vault, event: Event) -> Result<()> {
        {
            let mut events = self.events.write().unwrap();
            if let Some(slot) = events.iter_mut().find(|e| e.id == event.id) {
                *slot = event;
            } else {
                return Ok(());
            }
        }
        self.persist(vault)
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
