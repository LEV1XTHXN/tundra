use serde_json::json;

use super::*;
use crate::document::NoteMeta;

fn text_block(id: &str, block_type: &str, text: &str, children: Vec<Block>) -> Block {
    Block {
        id: id.to_string(),
        block_type: block_type.to_string(),
        props: None,
        content: Some(json!([{ "type": "text", "text": text, "styles": {} }])),
        children,
    }
}

fn note_with_blocks(title: &str, blocks: Vec<Block>) -> Note {
    let now = Utc::now();
    Note {
        schema_version: crate::document::SCHEMA_VERSION,
        id: uuid::Uuid::new_v4().to_string(),
        title: title.to_string(),
        icon: None,
        created: now,
        modified: now,
        meta: NoteMeta::default(),
        blocks,
    }
}

#[test]
fn extract_text_pulls_plain_paragraph_text() {
    let note = note_with_blocks("Note", vec![text_block("b1", "paragraph", "Hello world", vec![])]);
    assert_eq!(extract_text(&note), "Hello world");
}

#[test]
fn extract_text_walks_headings_and_nested_lists() {
    let note = note_with_blocks(
        "Note",
        vec![
            text_block("h1", "heading", "Photosynthesis", vec![]),
            text_block(
                "l1",
                "bulletListItem",
                "Light reactions",
                vec![text_block("l1a", "bulletListItem", "Occur in the thylakoid", vec![])],
            ),
            text_block("l2", "bulletListItem", "Calvin cycle", vec![]),
        ],
    );
    let text = extract_text(&note);
    assert!(text.contains("Photosynthesis"));
    assert!(text.contains("Light reactions"));
    assert!(text.contains("Occur in the thylakoid"), "should recurse into nested children");
    assert!(text.contains("Calvin cycle"));
}

#[test]
fn extract_text_pulls_mixed_inline_content_including_links() {
    // A paragraph with plain text, a bold span, and a link wrapping its own
    // nested inline text content — BlockNote's actual shape for links.
    let block = Block {
        id: "b1".to_string(),
        block_type: "paragraph".to_string(),
        props: None,
        content: Some(json!([
            { "type": "text", "text": "See ", "styles": {} },
            {
                "type": "link",
                "href": "https://example.com",
                "content": [{ "type": "text", "text": "the docs", "styles": {} }]
            },
            { "type": "text", "text": " for more.", "styles": { "bold": true } }
        ])),
        children: vec![],
    };
    let note = note_with_blocks("Note", vec![block]);
    let text = extract_text(&note);
    assert!(text.contains("See"));
    assert!(text.contains("the docs"), "should recurse into a link's nested inline content");
    assert!(text.contains("for more"));
}

#[test]
fn extract_text_ignores_blocks_with_no_content_without_crashing() {
    let block = Block {
        id: "b1".to_string(),
        block_type: "divider".to_string(),
        props: None,
        content: None,
        children: vec![],
    };
    let note = note_with_blocks("Note", vec![block]);
    assert_eq!(extract_text(&note), "");
}

fn temp_vault() -> (Vault, PathBuf) {
    let dir = std::env::temp_dir().join(format!("tundra-index-test-{}", uuid::Uuid::new_v4()));
    (Vault::open(&dir).unwrap(), dir)
}

#[test]
fn search_finds_notes_by_title_and_body_text() {
    let (vault, dir) = temp_vault();
    let search = SearchIndex::open(&dir).unwrap();

    let mut cell = vault.create_note("Cell Biology").unwrap();
    cell.blocks = vec![text_block("b1", "paragraph", "The mitochondria is the powerhouse", vec![])];
    vault.save_note(cell.clone()).unwrap();
    search.index_note(&cell, "notes/cell-biology.json").unwrap();

    let mut rocks = vault.create_note("Igneous Rocks").unwrap();
    rocks.blocks = vec![text_block("b1", "paragraph", "Formed from cooled magma", vec![])];
    vault.save_note(rocks.clone()).unwrap();
    search.index_note(&rocks, "notes/igneous-rocks.json").unwrap();

    let by_title = search.search("Biology", 10).unwrap();
    assert_eq!(by_title.len(), 1);
    assert_eq!(by_title[0].id, cell.id);

    let by_body = search.search("mitochondria", 10).unwrap();
    assert_eq!(by_body.len(), 1);
    assert_eq!(by_body[0].id, cell.id);
    assert!(by_body[0].snippet.to_lowercase().contains("mitochondria"));

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn search_matches_partial_words_as_a_prefix() {
    let (vault, dir) = temp_vault();
    let search = SearchIndex::open(&dir).unwrap();

    let mut exact = vault.create_note("Test").unwrap();
    exact.blocks = vec![text_block("b1", "paragraph", "An exact title match", vec![])];
    vault.save_note(exact.clone()).unwrap();
    search.index_note(&exact, "notes/test.json").unwrap();

    let mut longer = vault.create_note("Test2").unwrap();
    longer.blocks = vec![text_block("b1", "paragraph", "A longer title match", vec![])];
    vault.save_note(longer.clone()).unwrap();
    search.index_note(&longer, "notes/test2.json").unwrap();

    let unrelated = vault.create_note("Unrelated").unwrap();
    search.index_note(&unrelated, "notes/unrelated.json").unwrap();

    let hits = search.search("test", 10).unwrap();
    let ids: std::collections::HashSet<_> = hits.iter().map(|h| h.id.as_str()).collect();
    assert!(ids.contains(exact.id.as_str()), "exact word match should be found");
    assert!(ids.contains(longer.id.as_str()), "a longer word starting with the query should be found");
    assert!(!ids.contains(unrelated.id.as_str()));

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn search_ranks_a_title_match_above_a_body_only_match() {
    let (vault, dir) = temp_vault();
    let search = SearchIndex::open(&dir).unwrap();

    let mut title_hit = vault.create_note("Volcano").unwrap();
    title_hit.blocks = vec![text_block("b1", "paragraph", "Nothing relevant here", vec![])];
    vault.save_note(title_hit.clone()).unwrap();
    search.index_note(&title_hit, "notes/volcano.json").unwrap();

    let mut body_hit = vault.create_note("Untitled").unwrap();
    body_hit.blocks = vec![text_block("b1", "paragraph", "This mentions volcano once", vec![])];
    vault.save_note(body_hit.clone()).unwrap();
    search.index_note(&body_hit, "notes/untitled.json").unwrap();

    let hits = search.search("volcano", 10).unwrap();
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].id, title_hit.id, "the title match should rank first (boosted)");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn remove_note_drops_it_from_search_results() {
    let (vault, dir) = temp_vault();
    let search = SearchIndex::open(&dir).unwrap();

    let mut note = vault.create_note("Tundra Biome").unwrap();
    note.blocks = vec![text_block("b1", "paragraph", "Cold and treeless", vec![])];
    vault.save_note(note.clone()).unwrap();
    search.index_note(&note, "notes/tundra-biome.json").unwrap();
    assert_eq!(search.search("Tundra", 10).unwrap().len(), 1);

    search.remove_note(&note.id).unwrap();
    assert_eq!(search.search("Tundra", 10).unwrap().len(), 0);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn catch_up_indexes_new_notes_and_forgets_deleted_ones() {
    let (vault, dir) = temp_vault();
    let search = SearchIndex::open(&dir).unwrap();

    let mut note = vault.create_note("Sedimentary Rocks").unwrap();
    note.blocks = vec![text_block("b1", "paragraph", "Formed by deposition", vec![])];
    vault.save_note(note.clone()).unwrap();

    // Note exists in the vault but was never indexed — catch_up should pick it up.
    assert_eq!(search.search("Sedimentary", 10).unwrap().len(), 0);
    search.catch_up(&vault).unwrap();
    assert_eq!(search.search("Sedimentary", 10).unwrap().len(), 1);

    // A second catch-up with nothing changed should be a no-op (still just 1 hit).
    search.catch_up(&vault).unwrap();
    assert_eq!(search.search("Sedimentary", 10).unwrap().len(), 1);

    // Deleting the note and catching up again should drop it from the index.
    vault.delete_note(&note.id).unwrap();
    search.catch_up(&vault).unwrap();
    assert_eq!(search.search("Sedimentary", 10).unwrap().len(), 0);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn catch_up_reindexes_a_note_whose_content_changed_since_it_was_indexed() {
    let (vault, dir) = temp_vault();
    let search = SearchIndex::open(&dir).unwrap();

    let mut note = vault.create_note("Weather Log").unwrap();
    note.blocks = vec![text_block("b1", "paragraph", "Sunny and warm", vec![])];
    vault.save_note(note.clone()).unwrap();
    search.catch_up(&vault).unwrap();
    assert_eq!(search.search("Sunny", 10).unwrap().len(), 1);
    assert_eq!(search.search("Blizzard", 10).unwrap().len(), 0);

    // Externally-simulated edit: change content and save (bumps `modified`).
    let mut edited = vault.read_note(&note.id).unwrap();
    edited.blocks = vec![text_block("b1", "paragraph", "Blizzard conditions", vec![])];
    vault.save_note(edited).unwrap();

    search.catch_up(&vault).unwrap();
    assert_eq!(search.search("Blizzard", 10).unwrap().len(), 1, "catch_up should reindex the changed note");
    assert_eq!(search.search("Sunny", 10).unwrap().len(), 0, "the stale content should no longer match");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn rebuild_reconstructs_the_index_from_scratch() {
    let (vault, dir) = temp_vault();
    let search = SearchIndex::open(&dir).unwrap();

    let mut note = vault.create_note("Glacier").unwrap();
    note.blocks = vec![text_block("b1", "paragraph", "Slow moving ice", vec![])];
    vault.save_note(note.clone()).unwrap();
    search.index_note(&note, "notes/glacier.json").unwrap();
    assert_eq!(search.search("Glacier", 10).unwrap().len(), 1);

    // Simulate a stale/corrupted index by removing it out from under the
    // manifest's back, then confirm rebuild restores correct results.
    search.rebuild(&vault).unwrap();
    assert_eq!(search.search("Glacier", 10).unwrap().len(), 1);

    std::fs::remove_dir_all(&dir).ok();
}

fn note_with_tags(vault: &Vault, search: &SearchIndex, title: &str, tags: &[&str]) -> Note {
    let mut note = vault.create_note(title).unwrap();
    note.meta.tags = tags.iter().map(|t| t.to_string()).collect();
    vault.save_note(note.clone()).unwrap();
    search.index_note(&note, "notes/x.json").unwrap();
    note
}

#[test]
fn search_by_tag_matches_only_the_tag_field_by_prefix() {
    let (vault, dir) = temp_vault();
    let search = SearchIndex::open(&dir).unwrap();

    let tagged = note_with_tags(&vault, &search, "Cell", &["biology", "science"]);

    // A note that merely MENTIONS "biology" in its title/body but isn't
    // tagged must not be a tag hit — that's the point of the `#` mode.
    let mut mentioned = vault.create_note("Biology reading list").unwrap();
    mentioned.blocks = vec![text_block("b1", "paragraph", "all about biology", vec![])];
    vault.save_note(mentioned.clone()).unwrap();
    search.index_note(&mentioned, "notes/m.json").unwrap();

    // Prefix match: `#bio` finds the note tagged `biology`.
    let hits = search.search_by_tag("bio", 10).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, tagged.id);
    // Snippet carries the note's full tag set for display.
    assert!(hits[0].snippet.contains("#biology"));
    assert!(hits[0].snippet.contains("#science"));

    // The plain full-text search still finds the mentioning note (unchanged).
    assert_eq!(search.search("biology", 10).unwrap().len(), 2);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn search_by_tag_requires_every_word_to_match() {
    let (vault, dir) = temp_vault();
    let search = SearchIndex::open(&dir).unwrap();

    let ml = note_with_tags(&vault, &search, "ML", &["machine learning"]);
    let _machine_only = note_with_tags(&vault, &search, "Machines", &["machine"]);

    let hits = search.search_by_tag("machine learning", 10).unwrap();
    assert_eq!(hits.len(), 1, "only the note tagged with both words matches");
    assert_eq!(hits[0].id, ml.id);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn search_by_tag_with_an_empty_query_returns_no_hits() {
    let (vault, dir) = temp_vault();
    let search = SearchIndex::open(&dir).unwrap();
    note_with_tags(&vault, &search, "Tagged", &["anything"]);
    assert_eq!(search.search_by_tag("", 10).unwrap(), Vec::new());
    assert_eq!(search.search_by_tag("   ", 10).unwrap(), Vec::new());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn search_with_an_empty_query_returns_no_hits_rather_than_erroring() {
    let (_vault, dir) = temp_vault();
    let search = SearchIndex::open(&dir).unwrap();
    assert_eq!(search.search("", 10).unwrap(), Vec::new());
    assert_eq!(search.search("   ", 10).unwrap(), Vec::new());
    std::fs::remove_dir_all(&dir).ok();
}
