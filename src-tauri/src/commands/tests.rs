use super::*;
use std::sync::Mutex;
use tauri::Manager;
use tundra_core::Block;

fn temp_vault_state() -> AppState {
    let dir = std::env::temp_dir().join(format!("tundra-cmd-test-{}", uuid::Uuid::new_v4()));
    let vault = Vault::open(&dir).expect("open temp vault");
    let search = SearchIndex::open(&dir).expect("open temp search index");
    let links = LinkIndex::open(&dir).expect("open temp link index");
    let calendar = CalendarStore::open(&vault).expect("open temp calendar store");
    let spellcheck = SpellChecker::open(&vault, &[]).expect("open temp spellchecker");
    AppState {
        vault: Mutex::new(Some(vault)),
        search: Mutex::new(Some(Arc::new(search))),
        links: Mutex::new(Some(Arc::new(links))),
        calendar: Mutex::new(Some(calendar)),
        spellcheck: Mutex::new(Some(spellcheck)),
        ..Default::default()
    }
}

fn tree_contains_note(nodes: &[TreeNode], id: &str) -> bool {
    nodes.iter().any(|n| match n {
        TreeNode::Note(s) => s.id == id,
        TreeNode::Folder(f) => tree_contains_note(&f.children, id),
    })
}

/// Smoke test for the command wiring itself (not re-testing vault logic,
/// already covered in tundra-core): drives the commands exactly as the
/// frontend would, through `tauri::test`'s mock runtime.
#[test]
fn smoke_create_list_move_delete_through_commands() {
    let app = tauri::test::mock_builder()
        .manage(temp_vault_state())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("failed to build mock app");
    let state: State<AppState> = app.state();

    let note = create_note(state.clone(), "Alpha".into()).expect("create_note");
    let tree = list_tree(state.clone()).expect("list_tree");
    assert!(tree_contains_note(&tree, &note.id));

    create_folder(state.clone(), "Folder".into()).expect("create_folder");
    move_note(state.clone(), note.id.clone(), "Folder".into()).expect("move_note");
    let tree = list_tree(state.clone()).expect("list_tree after move");
    let folder = tree
        .iter()
        .find_map(|n| match n {
            TreeNode::Folder(f) if f.name == "Folder" => Some(f),
            _ => None,
        })
        .expect("Folder present in tree");
    assert!(tree_contains_note(&folder.children, &note.id));

    delete_note(state.clone(), note.id.clone()).expect("delete_note");
    let tree = list_tree(state).expect("list_tree after delete");
    assert!(!tree_contains_note(&tree, &note.id));
}

/// Vault cleanup deletes empty-bodied notes (any title) but keeps notes with
/// real content, and drops the deleted notes from the tree + search index.
#[test]
fn cleanup_empty_notes_removes_only_empty_notes() {
    let app = tauri::test::mock_builder()
        .manage(temp_vault_state())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("failed to build mock app");
    let state: State<AppState> = app.state();

    // Two fresh (empty) notes and one with real content.
    let empty_a = create_note(state.clone(), "Untitled".into()).expect("create empty a");
    let empty_b = create_note(state.clone(), "Titled but blank".into()).expect("create empty b");
    let mut kept = create_note(state.clone(), "Real".into()).expect("create kept");
    kept.blocks[0].content =
        Some(serde_json::json!([{ "type": "text", "text": "content", "styles": {} }]));
    save_note(state.clone(), kept.clone()).expect("save kept");

    let deleted = cleanup_empty_notes(state.clone()).expect("cleanup");
    assert_eq!(deleted.len(), 2);
    assert!(deleted.contains(&empty_a.id) && deleted.contains(&empty_b.id));

    let tree = list_tree(state.clone()).expect("list_tree after cleanup");
    assert!(!tree_contains_note(&tree, &empty_a.id));
    assert!(!tree_contains_note(&tree, &empty_b.id));
    assert!(tree_contains_note(&tree, &kept.id), "note with content survives");
}

/// Regression: a tag added (or removed) through the tag commands must show
/// up in `#tag` search immediately, without a vault reopen — `save_note`
/// only refreshes the in-memory summary index, so the command layer has to
/// reindex the note into the Tantivy index itself.
#[test]
fn tag_mutations_are_searchable_without_a_reopen() {
    let app = tauri::test::mock_builder()
        .manage(temp_vault_state())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("failed to build mock app");
    let state: State<AppState> = app.state();

    let note = create_note(state.clone(), "Photosynthesis".into()).expect("create_note");
    // Not yet tagged: a tag search finds nothing.
    assert!(search_by_tag(state.clone(), "biology".into(), 10).unwrap().is_empty());

    add_note_tag(state.clone(), note.id.clone(), "biology".into()).expect("add_note_tag");
    let hits = search_by_tag(state.clone(), "biology".into(), 10).unwrap();
    assert_eq!(hits.len(), 1, "the newly added tag should be searchable at once");
    assert_eq!(hits[0].id, note.id);

    // set_note_tags replaces the set — the old tag stops matching, the new one starts.
    set_note_tags(state.clone(), note.id.clone(), vec!["chemistry".into()]).expect("set_note_tags");
    assert!(search_by_tag(state.clone(), "biology".into(), 10).unwrap().is_empty());
    assert_eq!(search_by_tag(state.clone(), "chemistry".into(), 10).unwrap().len(), 1);

    // Removing it clears the last tag hit.
    remove_note_tag(state.clone(), note.id.clone(), "chemistry".into()).expect("remove_note_tag");
    assert!(search_by_tag(state.clone(), "chemistry".into(), 10).unwrap().is_empty());
}

/// Renaming a tag must apply to *every* note carrying it (a global rename),
/// not fork a copy on one note — and the new name is searchable at once while
/// the old one stops matching everywhere.
#[test]
fn rename_tag_applies_across_all_notes() {
    let app = tauri::test::mock_builder()
        .manage(temp_vault_state())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("failed to build mock app");
    let state: State<AppState> = app.state();

    let a = create_note(state.clone(), "Leaf".into()).expect("create_note a");
    let b = create_note(state.clone(), "Root".into()).expect("create_note b");
    add_note_tag(state.clone(), a.id.clone(), "biology".into()).expect("tag a");
    add_note_tag(state.clone(), b.id.clone(), "biology".into()).expect("tag b");
    // b also carries the target name already — the rename must collapse the dup.
    add_note_tag(state.clone(), b.id.clone(), "science".into()).expect("tag b science");

    rename_tag(state.clone(), "biology".into(), "science".into()).expect("rename_tag");

    // Old name gone everywhere; new name matches both notes.
    assert!(search_by_tag(state.clone(), "biology".into(), 10).unwrap().is_empty());
    let hits = search_by_tag(state.clone(), "science".into(), 10).unwrap();
    assert_eq!(hits.len(), 2, "both notes should carry the renamed tag");

    // No duplicate on b, and a now reads back with the new tag.
    let vault = current(&state).unwrap();
    assert_eq!(vault.read_note(&a.id).unwrap().meta.tags, vec!["science"]);
    assert_eq!(vault.read_note(&b.id).unwrap().meta.tags, vec!["science"]);
}

/// `list_tags` reports every distinct tag in the vault; `delete_tag` drops a
/// tag from every note that carries it (permanent, vault-wide) and it stops
/// being listed or searchable.
#[test]
fn list_and_delete_tags_span_the_vault() {
    let app = tauri::test::mock_builder()
        .manage(temp_vault_state())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("failed to build mock app");
    let state: State<AppState> = app.state();

    let a = create_note(state.clone(), "Leaf".into()).expect("create a");
    let b = create_note(state.clone(), "Root".into()).expect("create b");
    add_note_tag(state.clone(), a.id.clone(), "biology".into()).expect("tag a");
    add_note_tag(state.clone(), a.id.clone(), "science".into()).expect("tag a2");
    add_note_tag(state.clone(), b.id.clone(), "biology".into()).expect("tag b");

    // Distinct, sorted union across both notes.
    assert_eq!(list_tags(state.clone()).unwrap(), vec!["biology", "science"]);

    delete_tag(state.clone(), "biology".into()).expect("delete_tag");

    // Gone from the listing and from both notes; search no longer matches it.
    assert_eq!(list_tags(state.clone()).unwrap(), vec!["science"]);
    assert!(search_by_tag(state.clone(), "biology".into(), 10).unwrap().is_empty());
    let vault = current(&state).unwrap();
    assert_eq!(vault.read_note(&a.id).unwrap().meta.tags, vec!["science"]);
    assert!(vault.read_note(&b.id).unwrap().meta.tags.is_empty());
}

/// Phase 2 step 1 acceptance at the command boundary: importing an image
/// through the command stores it content-addressed under
/// `attachments/images/<shard>/`, and a note embedding that attachment
/// alongside a table survives a save → reload unchanged (persistence).
#[test]
fn import_attachment_and_embed_survive_reload_through_commands() {
    let app = tauri::test::mock_builder()
        .manage(temp_vault_state())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("failed to build mock app");
    let state: State<AppState> = app.state();

    // Import an image by content, exactly as the editor's uploadFile does.
    let png = b"\x89PNG demo bytes".to_vec();
    let rel = import_attachment(state.clone(), AttachmentKind::Image, "photo.png".into(), png.clone())
        .expect("import_attachment");
    assert!(rel.replace('\\', "/").starts_with("attachments/images/"));

    // Build a note with an image embed (storing the vault-relative path +
    // original filename) and a table block, then persist it.
    let mut note = create_note(state.clone(), "Rich".into()).expect("create_note");
    note.blocks = vec![
        Block {
            id: "img-1".into(),
            block_type: "image".into(),
            props: Some(serde_json::json!({ "url": rel, "name": "photo.png" })),
            content: None,
            children: vec![],
        },
        Block {
            id: "tbl-1".into(),
            block_type: "table".into(),
            props: None,
            content: Some(serde_json::json!({
                "type": "tableContent",
                "rows": [{ "cells": ["a", "b"] }]
            })),
            children: vec![],
        },
    ];
    save_note(state.clone(), note.clone()).expect("save_note");

    // Reload from disk: both the image embed (with its stored path) and the
    // table must come back intact.
    let reread = read_note(state.clone(), note.id.clone()).expect("read_note");
    assert_eq!(reread.blocks.len(), 2);
    assert_eq!(reread.blocks[0].block_type, "image");
    assert_eq!(reread.blocks[0].props.as_ref().unwrap()["url"], serde_json::json!(rel));
    assert_eq!(reread.blocks[1].block_type, "table");
    assert!(reread.blocks[1].content.is_some());
}

/// Phase 2 step 5 acceptance at the command boundary: the quick note is a
/// standalone scratchpad — it round-trips through save/read but never enters
/// the notes listing.
#[test]
fn quick_note_scratchpad_through_commands_is_not_a_vault_note() {
    let app = tauri::test::mock_builder()
        .manage(temp_vault_state())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("failed to build mock app");
    let state: State<AppState> = app.state();

    let mut quick = read_quick_note(state.clone()).expect("read_quick_note");
    quick.blocks = vec![Block {
        id: "b1".into(),
        block_type: "paragraph".into(),
        props: None,
        content: Some(serde_json::json!([{ "type": "text", "text": "capture", "styles": {} }])),
        children: vec![],
    }];
    save_quick_note(state.clone(), quick.clone()).expect("save_quick_note");

    let reread = read_quick_note(state.clone()).expect("re-read");
    assert_eq!(reread.blocks[0].content, quick.blocks[0].content);

    // It must not appear among the vault's notes.
    assert!(list_notes(state).expect("list_notes").is_empty());
}

/// Phase 2 step 2 acceptance at the command boundary: an id-backed link
/// drives backlinks + graph_data, a rename does NOT rewrite the referrer,
/// and title resolution returns the current title.
#[test]
fn links_backlinks_graph_and_rename_through_commands() {
    let app = tauri::test::mock_builder()
        .manage(temp_vault_state())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("failed to build mock app");
    let state: State<AppState> = app.state();

    let target = create_note(state.clone(), "Target".into()).expect("create target");
    let mut referrer = create_note(state.clone(), "Referrer".into()).expect("create referrer");
    referrer.blocks = vec![Block {
        id: "b1".into(),
        block_type: "paragraph".into(),
        props: None,
        content: Some(serde_json::json!([
            { "type": "text", "text": "see ", "styles": {} },
            { "type": tundra_core::LINK_INLINE_TYPE,
              "props": { "noteId": target.id, "label": "Target" } }
        ])),
        children: vec![],
    }];
    save_note(state.clone(), referrer.clone()).expect("save referrer");

    // Backlinks of the target include the referrer.
    let back = backlinks(state.clone(), target.id.clone()).expect("backlinks");
    assert_eq!(back.iter().map(|s| s.id.clone()).collect::<Vec<_>>(), vec![referrer.id.clone()]);

    // Graph has both notes and the one resolved edge.
    let graph = graph_data(state.clone()).expect("graph_data");
    assert_eq!(graph.nodes.len(), 2);
    assert_eq!(graph.edges.len(), 1);
    assert_eq!(graph.edges[0].source, referrer.id);
    assert_eq!(graph.edges[0].target, target.id);

    // Rename the target; the referrer file must be untouched (no repair),
    // and title resolution reflects the NEW title.
    let mut renamed = read_note(state.clone(), target.id.clone()).expect("read target");
    renamed.title = "Renamed Target".into();
    save_note(state.clone(), renamed).expect("save renamed");

    let referrer_after = read_note(state.clone(), referrer.id.clone()).expect("read referrer");
    assert_eq!(referrer_after.blocks[0].content, referrer.blocks[0].content,
        "referrer must not be rewritten on target rename");
    let resolved = resolve_titles(state.clone(), vec![target.id.clone()]).expect("resolve");
    assert_eq!(resolved[0].title, "Renamed Target");
}
