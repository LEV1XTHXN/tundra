use super::*;

fn block(id: &str, children: Vec<Block>) -> Block {
    Block {
        id: id.to_string(),
        block_type: "paragraph".to_string(),
        props: None,
        content: None,
        children,
    }
}

#[test]
fn validate_passes_on_fresh_note() {
    let note = Note::new("Photosynthesis");
    assert!(note.validate().is_ok());
}

#[test]
fn validate_fails_on_duplicate_id_across_nesting() {
    let mut note = Note::new("Untitled");
    // Duplicate lives inside a nested child, not just at the top level.
    note.blocks = vec![block("a", vec![block("b", vec![])]), block("a", vec![])];
    match note.validate() {
        Err(CoreError::DuplicateBlockId(id)) => assert_eq!(id, "a"),
        other => panic!("expected DuplicateBlockId, got {other:?}"),
    }
}

#[test]
fn validate_fails_on_empty_id() {
    let mut note = Note::new("Untitled");
    note.blocks = vec![block("", vec![])];
    assert!(matches!(note.validate(), Err(CoreError::EmptyBlockId)));
}

#[test]
fn validate_fails_on_empty_id_nested() {
    let mut note = Note::new("Untitled");
    note.blocks = vec![block("a", vec![block("", vec![])])];
    assert!(matches!(note.validate(), Err(CoreError::EmptyBlockId)));
}

/// A Phase 0 (v1) block with raw *string* content, as written by the old
/// textarea skeleton — the shape the editor used to silently discard.
fn v1_string_block(id: &str, text: &str) -> Block {
    Block {
        id: id.to_string(),
        block_type: "paragraph".to_string(),
        props: None,
        content: Some(Value::String(text.to_string())),
        children: Vec::new(),
    }
}

#[test]
fn migrate_v1_string_content_becomes_a_text_node_preserving_text() {
    let mut note = Note::new("Legacy");
    note.schema_version = 1;
    note.blocks = vec![v1_string_block("b1", "note note note\n\n# Note \n\nHello")];

    note.migrate();

    assert_eq!(note.schema_version, SCHEMA_VERSION);
    let expected = serde_json::json!([
        { "type": "text", "text": "note note note\n\n# Note \n\nHello", "styles": {} }
    ]);
    assert_eq!(note.blocks[0].content.as_ref().unwrap(), &expected);
}

#[test]
fn migrate_recurses_into_children() {
    let mut note = Note::new("Nested");
    note.schema_version = 1;
    let mut parent = v1_string_block("p", "parent text");
    parent.children = vec![v1_string_block("c", "child text")];
    note.blocks = vec![parent];

    note.migrate();

    assert_eq!(
        note.blocks[0].children[0].content.as_ref().unwrap(),
        &serde_json::json!([{ "type": "text", "text": "child text", "styles": {} }])
    );
}

#[test]
fn migrate_is_a_noop_for_already_current_array_content() {
    // A v2 note whose content is already BlockNote's inline array must be
    // left byte-for-byte identical (only the version stamp is idempotent).
    let mut note = Note::new("Modern");
    let array = serde_json::json!([{ "type": "text", "text": "hi", "styles": {} }]);
    note.blocks[0].content = Some(array.clone());

    note.migrate();

    assert_eq!(note.schema_version, SCHEMA_VERSION);
    assert_eq!(note.blocks[0].content.as_ref().unwrap(), &array);
}

/// Build a text node inline-content array with the given text.
fn text_content(text: &str) -> Value {
    serde_json::json!([{ "type": "text", "text": text, "styles": {} }])
}

#[test]
fn is_empty_true_for_fresh_note() {
    // A brand-new note is a single empty paragraph — the cleanup target.
    assert!(Note::new("Untitled").is_empty());
}

#[test]
fn is_empty_true_for_whitespace_only_and_multiple_blank_blocks() {
    let mut note = Note::new("Titled but blank");
    note.blocks = vec![
        block("a", vec![]),
        {
            let mut b = block("b", vec![]);
            b.content = Some(text_content("   \n\t "));
            b
        },
    ];
    // A meaningful title does NOT save it — cleanup keys off the body only.
    assert!(note.is_empty());
}

#[test]
fn is_empty_false_when_any_block_has_text() {
    let mut note = Note::new("Note");
    note.blocks[0].content = Some(text_content("hello"));
    assert!(!note.is_empty());
}

#[test]
fn is_empty_false_for_non_text_block_without_words() {
    // An image block with no caption text still counts as content.
    let mut note = Note::new("Photo");
    note.blocks = vec![Block {
        id: "img".into(),
        block_type: "image".into(),
        props: Some(serde_json::json!({ "url": "attachments/images/x.png" })),
        content: None,
        children: Vec::new(),
    }];
    assert!(!note.is_empty());
}

#[test]
fn is_empty_false_when_text_is_nested_in_a_child() {
    let mut note = Note::new("Nested");
    let mut parent = block("p", vec![]);
    let mut child = block("c", vec![]);
    child.content = Some(text_content("deep"));
    parent.children = vec![child];
    note.blocks = vec![parent];
    assert!(!note.is_empty());
}

#[test]
fn migrate_leaves_contentless_blocks_alone() {
    // Fresh notes have `content: None` — nothing to convert, just re-stamp.
    let mut note = Note::new("Empty");
    note.schema_version = 1;
    note.migrate();
    assert_eq!(note.schema_version, SCHEMA_VERSION);
    assert!(note.blocks[0].content.is_none());
}
