use super::*;

fn temp_vault() -> (Vault, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("tundra-cal-{}", Uuid::new_v4()));
    (Vault::open(&dir).unwrap(), dir)
}

fn day(y: i32, m: u32, d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, d).unwrap()
}

fn at(y: i32, m: u32, d: u32) -> DateTime<Utc> {
    day(y, m, d).and_hms_opt(9, 0, 0).unwrap().and_utc()
}

fn event(title: &str, start: DateTime<Utc>, end: Option<DateTime<Utc>>) -> Event {
    Event {
        id: String::new(),
        title: title.into(),
        start,
        end,
        all_day: false,
        note_ids: vec![],
        color: None,
        repeat: None,
        occurrence: None,
    }
}

/// A repeating event, every `interval` `unit`s from `start`, open-ended.
fn repeating(title: &str, start: DateTime<Utc>, unit: RepeatUnit, interval: u32) -> Event {
    Event {
        repeat: Some(Repeat { unit, interval, until: None, skip: vec![] }),
        ..event(title, start, None)
    }
}

/// The days a range query lands occurrences on, in order.
fn occurrence_days(hits: &[Event]) -> Vec<NaiveDate> {
    hits.iter().filter_map(|e| e.occurrence).collect()
}

#[test]
fn event_crud_persists_and_reloads() {
    let (vault, dir) = temp_vault();
    let store = CalendarStore::open(&vault).unwrap();

    let added = store.add(&vault, event("Standup", at(2026, 7, 10), None)).unwrap();
    assert!(!added.id.is_empty(), "add assigns a UUID");

    let mut edited = added.clone();
    edited.title = "Standup (moved)".into();
    store.update(&vault, edited).unwrap();

    // Reopen from disk — the store is persisted in-vault, not just in memory.
    let reopened = CalendarStore::open(&vault).unwrap();
    let listed = reopened.list();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].title, "Standup (moved)");

    reopened.delete(&vault, &added.id).unwrap();
    assert!(CalendarStore::open(&vault).unwrap().list().is_empty());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn range_overlap_includes_multiday_period_spanning_a_boundary() {
    let (vault, dir) = temp_vault();
    let store = CalendarStore::open(&vault).unwrap();

    // A single-day event inside the range.
    store.add(&vault, event("Inside", at(2026, 7, 15), None)).unwrap();
    // A multi-day period that starts BEFORE the range and ends INSIDE it.
    store
        .add(&vault, event("Trip", at(2026, 7, 8), Some(at(2026, 7, 12))))
        .unwrap();
    // An event entirely outside the range.
    store.add(&vault, event("Later", at(2026, 8, 1), None)).unwrap();

    let hits = store.events_in_range(day(2026, 7, 10), day(2026, 7, 20));
    let titles: Vec<_> = hits.iter().map(|e| e.title.clone()).collect();
    assert!(titles.contains(&"Inside".to_string()));
    assert!(titles.contains(&"Trip".to_string()), "period crossing the start boundary overlaps");
    assert!(!titles.contains(&"Later".to_string()));

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn events_stored_in_config_not_cache() {
    let (vault, dir) = temp_vault();
    let store = CalendarStore::open(&vault).unwrap();
    store.add(&vault, event("X", at(2026, 7, 1), None)).unwrap();

    assert!(dir.join(".vault/config/calendar.json").exists(), "events persist under config");
    assert!(!dir.join(".vault/cache").join("calendar.json").exists());

    std::fs::remove_dir_all(&dir).ok();
}

/// A colour remap rewrites only the events whose colour is a key in the map,
/// leaves uncoloured and unmapped events alone, and survives a reopen.
#[test]
fn recolor_rewrites_mapped_colors_and_persists() {
    let (vault, dir) = temp_vault();
    let store = CalendarStore::open(&vault).unwrap();

    let mut old = event("Old palette", at(2026, 7, 1), None);
    old.color = Some("#ef4444".into());
    store.add(&vault, old).unwrap();

    let mut custom = event("Hand-picked", at(2026, 7, 2), None);
    custom.color = Some("#123456".into());
    store.add(&vault, custom).unwrap();

    store.add(&vault, event("No colour", at(2026, 7, 3), None)).unwrap();

    let remap = HashMap::from([("#ef4444".to_string(), "#f69b94".to_string())]);
    assert_eq!(store.recolor(&vault, &remap).unwrap(), 1);

    let by_title = |events: &[Event], title: &str| {
        events.iter().find(|e| e.title == title).unwrap().color.clone()
    };
    // Read back from disk, not just memory — the remap must have been persisted.
    let reopened = CalendarStore::open(&vault).unwrap().list();
    assert_eq!(by_title(&reopened, "Old palette"), Some("#f69b94".into()));
    assert_eq!(by_title(&reopened, "Hand-picked"), Some("#123456".into()), "unmapped colour kept");
    assert_eq!(by_title(&reopened, "No colour"), None);

    std::fs::remove_dir_all(&dir).ok();
}

/// Re-running a remap is a no-op — the migration is idempotent, which is what
/// lets the frontend record its marker *after* the rewrite.
#[test]
fn recolor_is_idempotent_and_case_insensitive() {
    let (vault, dir) = temp_vault();
    let store = CalendarStore::open(&vault).unwrap();

    // Uppercase on disk (a hand-edited calendar.json) still matches.
    let mut ev = event("Shouty", at(2026, 7, 1), None);
    ev.color = Some("#EF4444".into());
    store.add(&vault, ev).unwrap();

    let remap = HashMap::from([("#ef4444".to_string(), "#f69b94".to_string())]);
    assert_eq!(store.recolor(&vault, &remap).unwrap(), 1);
    assert_eq!(store.recolor(&vault, &remap).unwrap(), 0, "second pass changes nothing");
    assert_eq!(store.list()[0].color, Some("#f69b94".into()));

    std::fs::remove_dir_all(&dir).ok();
}

// --- repeating events ---------------------------------------------------

/// One stored record, many occurrences: the series anchor sits outside the
/// queried range and every day inside it still comes back, at the anchor's clock
/// time.
#[test]
fn daily_repeat_expands_across_the_range() {
    let (vault, dir) = temp_vault();
    let store = CalendarStore::open(&vault).unwrap();
    store
        .add(&vault, repeating("Standup", at(2026, 7, 1), RepeatUnit::Day, 1))
        .unwrap();

    let hits = store.events_in_range(day(2026, 7, 10), day(2026, 7, 13));
    assert_eq!(
        occurrence_days(&hits),
        vec![day(2026, 7, 10), day(2026, 7, 11), day(2026, 7, 12), day(2026, 7, 13)],
    );
    assert!(hits.iter().all(|e| e.start.time() == at(2026, 7, 1).time()), "clock time carries over");
    assert_eq!(store.list().len(), 1, "only the anchor is stored");

    std::fs::remove_dir_all(&dir).ok();
}

/// A custom span (every N days) and a weekly repeat are the same expansion with a
/// different step.
#[test]
fn custom_span_and_weekly_repeats_step_correctly() {
    let (vault, dir) = temp_vault();
    let store = CalendarStore::open(&vault).unwrap();
    store
        .add(&vault, repeating("Every 3rd", at(2026, 7, 1), RepeatUnit::Day, 3))
        .unwrap();
    let weekly = store
        .add(&vault, repeating("Weekly", at(2026, 7, 1), RepeatUnit::Week, 1))
        .unwrap();

    let hits = store.events_in_range(day(2026, 7, 10), day(2026, 7, 20));
    let days_of = |title: &str| {
        occurrence_days(&hits.iter().filter(|e| e.title == title).cloned().collect::<Vec<_>>())
    };
    assert_eq!(
        days_of("Every 3rd"),
        vec![day(2026, 7, 10), day(2026, 7, 13), day(2026, 7, 16), day(2026, 7, 19)],
    );
    assert_eq!(days_of("Weekly"), vec![day(2026, 7, 15)]);
    assert!(hits.iter().all(|e| !e.id.is_empty()));
    assert!(
        hits.iter().filter(|e| e.title == "Weekly").all(|e| e.id == weekly.id),
        "occurrences keep the series id",
    );

    std::fs::remove_dir_all(&dir).ok();
}

/// A 29 Feb anchor has no counterpart in a common year — that year gets no
/// occurrence at all, rather than sliding onto the 28th or the 1st.
#[test]
fn yearly_repeat_skips_years_without_a_29_february() {
    let (vault, dir) = temp_vault();
    let store = CalendarStore::open(&vault).unwrap();
    store
        .add(&vault, repeating("Leap day", at(2024, 2, 29), RepeatUnit::Year, 1))
        .unwrap();

    let hits = store.events_in_range(day(2025, 1, 1), day(2028, 12, 31));
    assert_eq!(occurrence_days(&hits), vec![day(2028, 2, 29)]);

    std::fs::remove_dir_all(&dir).ok();
}

/// `until` stops the series; days past it are gone even when the query asks for
/// them.
#[test]
fn until_bounds_the_series() {
    let (vault, dir) = temp_vault();
    let store = CalendarStore::open(&vault).unwrap();
    let mut ev = repeating("Sprint", at(2026, 7, 1), RepeatUnit::Day, 1);
    ev.repeat.as_mut().unwrap().until = Some(day(2026, 7, 12));
    store.add(&vault, ev).unwrap();

    let hits = store.events_in_range(day(2026, 7, 10), day(2026, 7, 20));
    assert_eq!(occurrence_days(&hits), vec![day(2026, 7, 10), day(2026, 7, 11), day(2026, 7, 12)]);

    std::fs::remove_dir_all(&dir).ok();
}

/// Deleting a single day hides that occurrence and nothing else, and survives a
/// reopen — the skip list is part of the stored series.
#[test]
fn skip_occurrence_removes_one_day_only() {
    let (vault, dir) = temp_vault();
    let store = CalendarStore::open(&vault).unwrap();
    let added = store
        .add(&vault, repeating("Standup", at(2026, 7, 1), RepeatUnit::Day, 1))
        .unwrap();

    store.skip_occurrence(&vault, &added.id, day(2026, 7, 11)).unwrap();
    // Skipping the same day twice is a no-op rather than a duplicate entry.
    store.skip_occurrence(&vault, &added.id, day(2026, 7, 11)).unwrap();

    let reopened = CalendarStore::open(&vault).unwrap();
    assert_eq!(
        occurrence_days(&reopened.events_in_range(day(2026, 7, 10), day(2026, 7, 12))),
        vec![day(2026, 7, 10), day(2026, 7, 12)],
    );
    assert_eq!(reopened.list()[0].repeat.as_ref().unwrap().skip, vec![day(2026, 7, 11)]);

    std::fs::remove_dir_all(&dir).ok();
}

/// A repeating multi-day period counts as being in range whenever its SPAN
/// touches it — including an occurrence that began before the range started.
#[test]
fn repeating_period_reaches_into_the_range_from_before_it() {
    let (vault, dir) = temp_vault();
    let store = CalendarStore::open(&vault).unwrap();
    let mut ev = repeating("Conference", at(2026, 7, 1), RepeatUnit::Week, 1);
    ev.end = Some(at(2026, 7, 3));
    store.add(&vault, ev).unwrap();

    // Only 15–17 July covers the 16th; its first day is a day before the query.
    let hits = store.events_in_range(day(2026, 7, 16), day(2026, 7, 16));
    assert_eq!(occurrence_days(&hits), vec![day(2026, 7, 15)]);
    assert_eq!(hits[0].end.unwrap().date_naive(), day(2026, 7, 17), "the span moves with it");

    std::fs::remove_dir_all(&dir).ok();
}

/// Retiming one occurrence retimes the whole series without dragging the anchor
/// onto the edited day.
#[test]
fn editing_an_occurrence_keeps_the_series_anchor() {
    let (vault, dir) = temp_vault();
    let store = CalendarStore::open(&vault).unwrap();
    let added = store
        .add(&vault, repeating("Standup", at(2026, 7, 1), RepeatUnit::Day, 1))
        .unwrap();

    // The UI edits the 10 July instance: same day, moved to 14:00.
    let mut edit = store.events_in_range(day(2026, 7, 10), day(2026, 7, 10)).remove(0);
    edit.start = day(2026, 7, 10).and_hms_opt(14, 0, 0).unwrap().and_utc();
    edit.title = "Standup (later)".into();
    store.update(&vault, edit).unwrap();

    let stored = store.list();
    assert_eq!(stored[0].start, day(2026, 7, 1).and_hms_opt(14, 0, 0).unwrap().and_utc());
    assert_eq!(stored[0].title, "Standup (later)");
    assert_eq!(stored[0].occurrence, None, "the annotation never reaches the store");
    assert_eq!(stored[0].id, added.id);

    std::fs::remove_dir_all(&dir).ok();
}

/// Moving an occurrence's DATE moves the entire series by the same offset, and
/// drops skips that no longer name an occurrence.
#[test]
fn moving_an_occurrence_shifts_the_whole_series() {
    let (vault, dir) = temp_vault();
    let store = CalendarStore::open(&vault).unwrap();
    let added = store
        .add(&vault, repeating("Standup", at(2026, 7, 1), RepeatUnit::Week, 1))
        .unwrap();
    store.skip_occurrence(&vault, &added.id, day(2026, 7, 15)).unwrap();

    // The 8 July instance is dragged two days later.
    let mut edit = store.events_in_range(day(2026, 7, 8), day(2026, 7, 8)).remove(0);
    edit.start = at(2026, 7, 10);
    store.update(&vault, edit).unwrap();

    let stored = store.list();
    assert_eq!(stored[0].start.date_naive(), day(2026, 7, 3), "anchor moved by the same +2 days");
    assert!(stored[0].repeat.as_ref().unwrap().skip.is_empty(), "stale skips cleared");

    std::fs::remove_dir_all(&dir).ok();
}

/// Turning the repeat off from an occurrence leaves a plain event on THAT day —
/// the instance the user was looking at.
#[test]
fn clearing_the_repeat_keeps_the_edited_day() {
    let (vault, dir) = temp_vault();
    let store = CalendarStore::open(&vault).unwrap();
    store
        .add(&vault, repeating("Standup", at(2026, 7, 1), RepeatUnit::Day, 1))
        .unwrap();

    let mut edit = store.events_in_range(day(2026, 7, 10), day(2026, 7, 10)).remove(0);
    edit.repeat = None;
    store.update(&vault, edit).unwrap();

    let stored = store.list();
    assert_eq!(stored[0].start.date_naive(), day(2026, 7, 10));
    assert_eq!(stored[0].repeat, None);

    std::fs::remove_dir_all(&dir).ok();
}

/// A zero interval would step nowhere; it is clamped on the way in so expansion
/// can't spin.
#[test]
fn zero_interval_is_clamped_to_one() {
    let (vault, dir) = temp_vault();
    let store = CalendarStore::open(&vault).unwrap();
    store
        .add(&vault, repeating("Broken", at(2026, 7, 1), RepeatUnit::Day, 0))
        .unwrap();

    assert_eq!(store.list()[0].repeat.as_ref().unwrap().interval, 1);
    assert_eq!(store.events_in_range(day(2026, 7, 1), day(2026, 7, 3)).len(), 3);

    std::fs::remove_dir_all(&dir).ok();
}
