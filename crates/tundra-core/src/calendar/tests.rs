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
    }
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
