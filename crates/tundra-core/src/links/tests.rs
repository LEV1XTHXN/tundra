use serde_json::json;

use super::*;
use crate::document::NoteMeta;

/// A paragraph whose inline content is `text` followed by a note-link node
/// targeting `link_to` (an id) — the shape Phase 2 step 3's editor produces.
fn block_with_link(id: &str, text: &str, link_to: &str, label: &str) -> Block {
    Block {
        id: id.to_string(),
        block_type: "paragraph".to_string(),
        props: None,
        content: Some(json!([
            { "type": "text", "text": text, "styles": {} },
            { "type": LINK_INLINE_TYPE, "props": { "noteId": link_to, "label": label } }
        ])),
        children: vec![],
    }
}

fn note_with_blocks(id: &str, title: &str, blocks: Vec<Block>) -> Note {
    let now = Utc::now();
    Note {
        schema_version: crate::document::SCHEMA_VERSION,
        id: id.to_string(),
        title: title.to_string(),
        icon: None,
        created: now,
        modified: now,
        meta: NoteMeta::default(),
        blocks,
    }
}

#[test]
fn extract_link_ids_reads_id_backed_nodes_deduped_and_ordered() {
    let note = note_with_blocks(
        "src",
        "Source",
        vec![
            block_with_link("b1", "see ", "target-a", "A"),
            block_with_link("b2", "and ", "target-b", "B"),
            // A duplicate link to A (e.g. mentioned twice) collapses to one.
            block_with_link("b3", "again ", "target-a", "A renamed"),
        ],
    );
    assert_eq!(extract_link_ids(&note), vec!["target-a", "target-b"]);
}

#[test]
fn extract_link_ids_finds_links_nested_in_children() {
    let child = block_with_link("c1", "nested ", "deep-target", "Deep");
    let parent = Block {
        id: "p1".to_string(),
        block_type: "bulletListItem".to_string(),
        props: None,
        content: Some(json!([{ "type": "text", "text": "top", "styles": {} }])),
        children: vec![child],
    };
    let note = note_with_blocks("src", "Source", vec![parent]);
    assert_eq!(extract_link_ids(&note), vec!["deep-target"]);
}

#[test]
fn extract_link_ids_ignores_plain_text_and_hyperlinks() {
    let block = Block {
        id: "b1".to_string(),
        block_type: "paragraph".to_string(),
        props: None,
        content: Some(json!([
            { "type": "text", "text": "plain", "styles": {} },
            { "type": "link", "href": "https://example.com",
              "content": [{ "type": "text", "text": "external", "styles": {} }] }
        ])),
        children: vec![],
    };
    let note = note_with_blocks("src", "Source", vec![block]);
    assert!(extract_link_ids(&note).is_empty());
}

fn temp_vault() -> (Vault, PathBuf) {
    let dir = std::env::temp_dir().join(format!("tundra-links-test-{}", uuid::Uuid::new_v4()));
    (Vault::open(&dir).unwrap(), dir)
}

/// Persist a note through the vault AND update the link index, as the
/// command layer does on save.
fn save(vault: &Vault, links: &LinkIndex, note: &Note) {
    vault.save_note(note.clone()).unwrap();
    links.index_note(note).unwrap();
}

#[test]
fn backlinks_are_correct_and_graph_drops_broken_edges() {
    let (vault, dir) = temp_vault();
    let links = LinkIndex::open(&dir).unwrap();

    // Three real notes; A links to B, C links to B, B links to a deleted id.
    let a = vault.create_note("Alpha").unwrap();
    let b = vault.create_note("Beta").unwrap();
    let c = vault.create_note("Gamma").unwrap();

    let a_linked = note_with_blocks(&a.id, "Alpha", vec![block_with_link("x", "to ", &b.id, "Beta")]);
    let c_linked = note_with_blocks(&c.id, "Gamma", vec![block_with_link("x", "to ", &b.id, "Beta")]);
    let b_linked = note_with_blocks(&b.id, "Beta", vec![block_with_link("x", "to ", "ghost-id", "Ghost")]);
    save(&vault, &links, &a_linked);
    save(&vault, &links, &c_linked);
    save(&vault, &links, &b_linked);

    // Backlinks of B are A and C (sorted by title).
    let back = links.backlinks(&vault, &b.id);
    assert_eq!(back.iter().map(|s| s.id.clone()).collect::<Vec<_>>(), vec![a.id.clone(), c.id.clone()]);

    // Graph: 3 nodes; edges A→B and C→B only. B→ghost is broken → no edge.
    // (Edge order is by source id — random UUIDs — so compare as a set.)
    let graph = links.graph_data(&vault).unwrap();
    assert_eq!(graph.nodes.len(), 3);
    assert_eq!(graph.edges.len(), 2);
    assert!(graph.edges.contains(&GraphEdge { source: a.id.clone(), target: b.id.clone() }));
    assert!(graph.edges.contains(&GraphEdge { source: c.id.clone(), target: b.id.clone() }));
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn renaming_a_target_does_not_rewrite_referrers_and_link_still_resolves() {
    let (vault, dir) = temp_vault();
    let links = LinkIndex::open(&dir).unwrap();

    let target = vault.create_note("Original Title").unwrap();
    let referrer = vault.create_note("Referrer").unwrap();
    let referrer_linked = note_with_blocks(
        &referrer.id,
        "Referrer",
        vec![block_with_link("x", "see ", &target.id, "Original Title")],
    );
    save(&vault, &links, &referrer_linked);

    // Rename the target (title-only save through the vault, as the app does).
    let mut renamed = vault.read_note(&target.id).unwrap();
    renamed.title = "Brand New Title".to_string();
    save(&vault, &links, &renamed);

    // The referrer's file on disk must be UNCHANGED (no repair-on-rename):
    // its stored label is still the old title, and it still links by id.
    let referrer_on_disk = vault.read_note(&referrer.id).unwrap();
    assert_eq!(extract_link_ids(&referrer_on_disk), vec![target.id.clone()]);

    // Backlinks still resolve the referrer → target relationship by id.
    assert_eq!(
        links.backlinks(&vault, &target.id).iter().map(|s| s.id.clone()).collect::<Vec<_>>(),
        vec![referrer.id.clone()]
    );
    // And a live-label resolve returns the CURRENT title.
    let resolved = links.resolve_titles(&vault, &[target.id.clone()]);
    assert_eq!(resolved.len(), 1);
    assert_eq!(resolved[0].title, "Brand New Title");
}

#[test]
fn deleting_a_note_drops_its_edges_and_removes_it_as_a_backlink() {
    let (vault, dir) = temp_vault();
    let links = LinkIndex::open(&dir).unwrap();

    let a = vault.create_note("Alpha").unwrap();
    let b = vault.create_note("Beta").unwrap();
    let a_linked = note_with_blocks(&a.id, "Alpha", vec![block_with_link("x", "to ", &b.id, "Beta")]);
    save(&vault, &links, &a_linked);
    assert_eq!(links.backlinks(&vault, &b.id).len(), 1);

    // Delete A (the source). Its outgoing edge must disappear.
    vault.delete_note(&a.id).unwrap();
    links.remove_note(&a.id).unwrap();
    assert!(links.backlinks(&vault, &b.id).is_empty());
    assert!(links.graph_data(&vault).unwrap().edges.is_empty());
}

#[test]
fn rebuild_reconstructs_the_graph_from_notes_on_disk() {
    let (vault, dir) = temp_vault();
    let links = LinkIndex::open(&dir).unwrap();

    let a = vault.create_note("Alpha").unwrap();
    let b = vault.create_note("Beta").unwrap();
    // Save the link through the VAULT only (bypass the index), so the cache
    // is stale until we rebuild from disk.
    vault
        .save_note(note_with_blocks(&a.id, "Alpha", vec![block_with_link("x", "to ", &b.id, "Beta")]))
        .unwrap();
    assert!(links.graph_data(&vault).unwrap().edges.is_empty(), "cache is empty before rebuild");

    links.rebuild(&vault).unwrap();
    assert_eq!(
        links.graph_data(&vault).unwrap().edges,
        vec![GraphEdge { source: a.id.clone(), target: b.id.clone() }]
    );

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn catch_up_picks_up_new_links_and_forgets_deleted_notes() {
    let (vault, dir) = temp_vault();
    let links = LinkIndex::open(&dir).unwrap();

    let a = vault.create_note("Alpha").unwrap();
    let b = vault.create_note("Beta").unwrap();
    vault
        .save_note(note_with_blocks(&a.id, "Alpha", vec![block_with_link("x", "to ", &b.id, "Beta")]))
        .unwrap();

    links.catch_up(&vault).unwrap();
    assert_eq!(links.backlinks(&vault, &b.id).len(), 1);

    // Delete A on disk; catch_up should forget it and its edge.
    vault.delete_note(&a.id).unwrap();
    links.catch_up(&vault).unwrap();
    assert!(links.backlinks(&vault, &b.id).is_empty());

    std::fs::remove_dir_all(&dir).ok();
}
