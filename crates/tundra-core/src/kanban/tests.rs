use super::*;

fn temp_vault() -> (Vault, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("tundra-kanban-{}", Uuid::new_v4()));
    (Vault::open(&dir).unwrap(), dir)
}

/// Convenience: the single board in a store, panicking if not exactly one.
fn only_board(store: &KanbanStore) -> KanbanBoard {
    let boards = store.list();
    assert_eq!(boards.len(), 1, "expected exactly one board");
    boards.into_iter().next().unwrap()
}

#[test]
fn boards_persist_and_reload() {
    let (vault, dir) = temp_vault();
    let store = KanbanStore::open(&vault).unwrap();
    store.create_board(&vault, "Work").unwrap();

    assert!(dir.join(".vault/config/kanban.json").exists(), "boards persist under config");
    assert!(!dir.join(".vault/cache").join("kanban.json").exists());

    let reopened = KanbanStore::open(&vault).unwrap();
    let board = only_board(&reopened);
    assert_eq!(board.name, "Work");
    assert_eq!(board.columns.len(), 2, "seeded open / closed");
    assert!(board.columns.iter().all(|c| c.tag.is_none()), "default rows are untagged");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn dropping_a_card_into_a_tagged_column_tags_the_note() {
    let (vault, dir) = temp_vault();
    let store = KanbanStore::open(&vault).unwrap();
    let note = vault.create_note("Ship it").unwrap();

    store.create_board(&vault, "Work").unwrap();
    let board = only_board(&store);
    let todo = &board.columns[0];

    // Give the first column a tag, then drop the note into it.
    store
        .update_column(&vault, &board.id, &todo.id, "To do", Some("todo".into()))
        .unwrap();
    store.add_card(&vault, &board.id, &todo.id, &note.id).unwrap();

    // The card is placed AND the note gained the column's tag.
    let board = only_board(&store);
    assert_eq!(board.columns[0].note_ids, vec![note.id.clone()]);
    assert_eq!(vault.note_summary(&note.id).unwrap().tags, vec!["todo".to_string()]);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn moving_a_card_between_tagged_columns_swaps_the_tag() {
    let (vault, dir) = temp_vault();
    let store = KanbanStore::open(&vault).unwrap();
    let note = vault.create_note("Task").unwrap();

    store.create_board(&vault, "Work").unwrap();
    let board = only_board(&store);
    let (todo, done) = (board.columns[0].clone(), board.columns[1].clone());
    store.update_column(&vault, &board.id, &todo.id, "To do", Some("todo".into())).unwrap();
    store.update_column(&vault, &board.id, &done.id, "Done", Some("done".into())).unwrap();

    store.add_card(&vault, &board.id, &todo.id, &note.id).unwrap();
    assert_eq!(vault.note_summary(&note.id).unwrap().tags, vec!["todo".to_string()]);

    // Move To do -> Done: loses "todo", gains "done".
    store.move_card(&vault, &board.id, &note.id, &done.id, 0).unwrap();
    let board = only_board(&store);
    assert!(board.columns[0].note_ids.is_empty(), "left the source column");
    assert_eq!(board.columns[1].note_ids, vec![note.id.clone()]);
    assert_eq!(vault.note_summary(&note.id).unwrap().tags, vec!["done".to_string()]);

    // Removing from the board strips the last column's tag.
    store.remove_card(&vault, &board.id, &note.id).unwrap();
    assert!(vault.note_summary(&note.id).unwrap().tags.is_empty());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn kanban_tag_sorts_before_a_notes_existing_tags() {
    let (vault, dir) = temp_vault();
    let store = KanbanStore::open(&vault).unwrap();
    let note = vault.create_note("Task").unwrap();
    // The note already carries user tags before it ever touches a board.
    vault
        .set_note_tags(&note.id, vec!["biology".into(), "urgent".into()])
        .unwrap();

    store.create_board(&vault, "Work").unwrap();
    let board = only_board(&store);
    let (todo, done) = (board.columns[0].clone(), board.columns[1].clone());
    store.update_column(&vault, &board.id, &todo.id, "To do", Some("todo".into())).unwrap();
    store.update_column(&vault, &board.id, &done.id, "Done", Some("done".into())).unwrap();

    // Dropped into "To do": the board tag leads the list.
    store.add_card(&vault, &board.id, &todo.id, &note.id).unwrap();
    assert_eq!(
        vault.note_summary(&note.id).unwrap().tags,
        vec!["todo".to_string(), "biology".to_string(), "urgent".to_string()],
    );

    // Moved to "Done": the new board tag replaces the old one, still first.
    store.move_card(&vault, &board.id, &note.id, &done.id, 0).unwrap();
    assert_eq!(
        vault.note_summary(&note.id).unwrap().tags,
        vec!["done".to_string(), "biology".to_string(), "urgent".to_string()],
    );

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_note_appears_at_most_once_per_board() {
    let (vault, dir) = temp_vault();
    let store = KanbanStore::open(&vault).unwrap();
    let note = vault.create_note("Single").unwrap();
    store.create_board(&vault, "B").unwrap();
    let board = only_board(&store);
    let (a, b) = (board.columns[0].clone(), board.columns[1].clone());

    store.add_card(&vault, &board.id, &a.id, &note.id).unwrap();
    // Adding to a second column moves it rather than duplicating.
    store.add_card(&vault, &board.id, &b.id, &note.id).unwrap();

    let board = only_board(&store);
    assert!(board.columns[0].note_ids.is_empty());
    assert_eq!(board.columns[1].note_ids, vec![note.id.clone()]);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn reordering_within_an_untagged_column_leaves_tags_alone() {
    let (vault, dir) = temp_vault();
    let store = KanbanStore::open(&vault).unwrap();
    let n1 = vault.create_note("one").unwrap();
    let n2 = vault.create_note("two").unwrap();
    store.create_board(&vault, "B").unwrap();
    let board = only_board(&store);
    let col = board.columns[0].clone();

    store.add_card(&vault, &board.id, &col.id, &n1.id).unwrap();
    store.add_card(&vault, &board.id, &col.id, &n2.id).unwrap();
    // Move n2 to the front of the same column.
    store.move_card(&vault, &board.id, &n2.id, &col.id, 0).unwrap();

    let board = only_board(&store);
    assert_eq!(board.columns[0].note_ids, vec![n2.id.clone(), n1.id.clone()]);
    assert!(vault.note_summary(&n1.id).unwrap().tags.is_empty());
    assert!(vault.note_summary(&n2.id).unwrap().tags.is_empty());

    std::fs::remove_dir_all(&dir).ok();
}
