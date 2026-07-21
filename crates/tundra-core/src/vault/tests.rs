use super::*;
use crate::document::{Block, Icon};

fn temp_vault() -> (Vault, PathBuf) {
    let dir = std::env::temp_dir().join(format!("tundra-vault-test-{}", uuid::Uuid::new_v4()));
    (Vault::open(&dir).unwrap(), dir)
}

#[test]
fn save_note_rejects_invalid_note_and_writes_nothing() {
    let (vault, dir) = temp_vault();
    let mut note = vault.create_note("Bad Note").unwrap();
    // Corrupt the block tree: duplicate the sole block's id.
    let dup = note.blocks[0].clone();
    note.blocks.push(dup);

    let err = vault.save_note(note.clone()).unwrap_err();
    assert!(matches!(err, CoreError::DuplicateBlockId(_)));

    // The prior valid version on disk must be untouched, and no .tmp left behind.
    let reread = vault.read_note(&note.id).unwrap();
    assert_eq!(reread.blocks.len(), 1);
    let notes_dir = dir.join("notes");
    for entry in std::fs::read_dir(&notes_dir).unwrap() {
        let path = entry.unwrap().path();
        assert_ne!(path.extension().and_then(|e| e.to_str()), Some("tmp"));
    }

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn save_note_rejects_empty_block_id() {
    let (vault, dir) = temp_vault();
    let mut note = vault.create_note("Another Note").unwrap();
    note.blocks = vec![Block {
        id: String::new(),
        block_type: "paragraph".to_string(),
        props: None,
        content: None,
        children: Vec::new(),
    }];

    let err = vault.save_note(note).unwrap_err();
    assert!(matches!(err, CoreError::EmptyBlockId));

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn index_reflects_create_save_move_delete() {
    let (vault, dir) = temp_vault();

    let a = vault.create_note("Alpha").unwrap();
    let b = vault.create_note("Beta").unwrap();
    assert_eq!(vault.list_notes().unwrap().len(), 2);

    let mut edited = vault.read_note(&a.id).unwrap();
    edited.title = "Alpha Renamed".to_string();
    vault.save_note(edited).unwrap();
    let summary = vault
        .list_notes()
        .unwrap()
        .into_iter()
        .find(|s| s.id == a.id)
        .unwrap();
    assert_eq!(summary.title, "Alpha Renamed");

    vault.create_folder("Folder").unwrap();
    vault.move_note(&b.id, "Folder").unwrap();
    let summary = vault
        .list_notes()
        .unwrap()
        .into_iter()
        .find(|s| s.id == b.id)
        .unwrap();
    assert!(summary.path.contains("Folder/"));

    vault.delete_note(&a.id).unwrap();
    assert!(vault.read_note(&a.id).is_err());
    assert_eq!(vault.list_notes().unwrap().len(), 1);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn list_notes_serves_from_index_without_rereading_disk() {
    let (vault, dir) = temp_vault();
    let note = vault.create_note("Cached").unwrap();

    // Corrupt the underlying file after the index was built. If
    // `list_notes` re-read from disk, this would break the listing.
    let path = dir.join("notes").join(format!("{}.json", slugify("Cached")));
    fs::write(&path, b"not json").unwrap();

    let listed = vault.list_notes().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, note.id);
    assert_eq!(listed[0].title, "Cached");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn move_note_preserves_id_and_updates_index() {
    let (vault, dir) = temp_vault();
    let note = vault.create_note("Movable").unwrap();
    vault.create_folder("Destination").unwrap();
    vault.move_note(&note.id, "Destination").unwrap();

    let reread = vault.read_note(&note.id).unwrap();
    assert_eq!(reread.id, note.id);

    let summary = vault
        .list_notes()
        .unwrap()
        .into_iter()
        .find(|s| s.id == note.id)
        .unwrap();
    assert!(summary.path.contains("Destination/"));

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn interrupted_write_leaves_no_tmp_and_preserves_prior_version() {
    let (vault, dir) = temp_vault();
    let note = vault.create_note("Fragile").unwrap();
    let path = dir.join("notes").join(format!("{}.json", slugify("Fragile")));
    assert!(path.exists());

    // Force the next write to fail (simulating a crash partway through) by
    // making the note's PARENT DIRECTORY read-only: the atomic-write temp
    // file can't be created in it, so the write errors before it can touch
    // the existing file. Marking the target *file* read-only wouldn't do it
    // — on POSIX a rename/replace only needs write permission on the parent
    // directory, so the replace would succeed and the file would change.
    let parent = path.parent().unwrap();
    let mut perms = fs::metadata(parent).unwrap().permissions();
    perms.set_readonly(true);
    fs::set_permissions(parent, perms).unwrap();

    let mut edited = note.clone();
    edited.title = "Should not persist".to_string();
    let result = vault.save_note(edited);

    let mut perms = fs::metadata(parent).unwrap().permissions();
    perms.set_readonly(false);
    fs::set_permissions(parent, perms).unwrap();

    assert!(
        result.is_err(),
        "expected the write to fail when the notes directory is read-only"
    );

    for entry in std::fs::read_dir(dir.join("notes")).unwrap() {
        let p = entry.unwrap().path();
        assert_ne!(p.extension().and_then(|e| e.to_str()), Some("tmp"));
    }

    let reread = vault.read_note(&note.id).unwrap();
    assert_eq!(reread.title, "Fragile");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn self_write_registry_records_each_write() {
    let (vault, dir) = temp_vault();
    let note = vault.create_note("Tracked").unwrap();
    let path = dir.join("notes").join(format!("{}.json", slugify("Tracked")));

    assert!(vault.peek_self_write(&path).is_some());
    assert!(vault.consume_self_write(&path).is_some());
    assert!(vault.peek_self_write(&path).is_none());

    let mut edited = note.clone();
    edited.title = "Tracked v2".to_string();
    vault.save_note(edited).unwrap();
    assert!(vault.peek_self_write(&path).is_some());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn folder_create_rename_move_delete() {
    let (vault, dir) = temp_vault();
    vault.create_folder("Biology").unwrap();
    assert!(dir.join("notes/Biology").is_dir());

    let note = vault.create_note("Cell").unwrap();
    vault.move_note(&note.id, "Biology").unwrap();

    vault.rename_folder("Biology", "Life Sciences").unwrap();
    assert!(dir.join("notes/Life Sciences").is_dir());
    assert!(!dir.join("notes/Biology").exists());
    assert_eq!(vault.read_note(&note.id).unwrap().id, note.id);
    let summary_path = vault
        .list_notes()
        .unwrap()
        .into_iter()
        .find(|s| s.id == note.id)
        .unwrap()
        .path;
    assert!(summary_path.contains("Life Sciences/"));

    vault.create_folder("Science").unwrap();
    vault.move_folder("Life Sciences", "Science").unwrap();
    assert!(dir.join("notes/Science/Life Sciences").is_dir());
    assert_eq!(vault.read_note(&note.id).unwrap().id, note.id);

    vault.delete_folder("Science").unwrap();
    assert!(!dir.join("notes/Science").exists());
    assert!(vault.read_note(&note.id).is_err());
    assert_eq!(vault.list_notes().unwrap().len(), 0);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn list_tree_reflects_folders_and_notes_from_index() {
    let (vault, dir) = temp_vault();
    vault.create_folder("Biology").unwrap();
    vault.create_folder("Biology/Plants").unwrap(); // nested, empty
    let n1 = vault.create_note("Root Note").unwrap();
    let n2 = vault.create_note("Cell").unwrap();
    vault.move_note(&n2.id, "Biology").unwrap();

    let tree = vault.list_tree();

    let biology_children = tree
        .iter()
        .find_map(|n| match n {
            TreeNode::Folder(f) if f.name == "Biology" => Some(&f.children),
            _ => None,
        })
        .expect("Biology folder present");

    assert!(biology_children
        .iter()
        .any(|n| matches!(n, TreeNode::Folder(f) if f.name == "Plants")));
    assert!(biology_children
        .iter()
        .any(|n| matches!(n, TreeNode::Note(s) if s.id == n2.id)));
    assert!(tree
        .iter()
        .any(|n| matches!(n, TreeNode::Note(s) if s.id == n1.id)));

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn note_summary_includes_icon() {
    let (vault, dir) = temp_vault();
    let mut note = vault.create_note("Iconic").unwrap();
    note.icon = Some(Icon::Emoji("1f331".to_string()));
    vault.save_note(note.clone()).unwrap();

    let summary = vault
        .list_notes()
        .unwrap()
        .into_iter()
        .find(|s| s.id == note.id)
        .unwrap();
    match summary.icon {
        Some(Icon::Emoji(ref cp)) => assert_eq!(cp, "1f331"),
        other => panic!("expected emoji icon, got {other:?}"),
    }

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn templates_crud_round_trip_and_stay_out_of_the_note_index() {
    let (vault, dir) = temp_vault();

    // A brand-new vault has no templates.
    assert!(vault.list_templates().unwrap().is_empty());

    // Create two templates; both list, title-sorted, and neither enters the
    // note tree/index (templates are not "notes").
    let meeting = vault.create_template("Meeting notes").unwrap();
    let daily = vault.create_template("Daily journal").unwrap();
    let listed = vault.list_templates().unwrap();
    assert_eq!(
        listed.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(),
        vec!["Daily journal", "Meeting notes"],
        "templates list title-sorted"
    );
    assert!(vault.list_notes().unwrap().is_empty(), "templates are not notes");
    assert!(
        vault.list_tree().is_empty(),
        "templates never appear in the note tree"
    );

    // Edit + read-back a template's body and icon.
    let mut edited = vault.read_template(&meeting.id).unwrap();
    edited.icon = Some(Icon::Emoji("1f4dd".to_string()));
    edited.blocks[0].content =
        Some(serde_json::json!([{ "type": "text", "text": "## Agenda", "styles": {} }]));
    vault.save_template(edited.clone()).unwrap();

    let reread = vault.read_template(&meeting.id).unwrap();
    assert_eq!(reread.id, meeting.id);
    assert_eq!(reread.blocks[0].content, edited.blocks[0].content);
    match reread.icon {
        Some(Icon::Emoji(ref cp)) => assert_eq!(cp, "1f4dd"),
        other => panic!("expected emoji icon, got {other:?}"),
    }

    // Delete one; it drops out of the listing, the other stays.
    vault.delete_template(&daily.id).unwrap();
    assert!(vault.read_template(&daily.id).is_err());
    let after = vault.list_templates().unwrap();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].id, meeting.id);

    // Templates survive a reopen (they're plain files under templates/).
    let reopened = Vault::open(&dir).unwrap();
    assert_eq!(reopened.list_templates().unwrap().len(), 1);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn save_template_rejects_invalid_block_tree() {
    let (vault, dir) = temp_vault();
    let mut tpl = vault.create_template("Bad").unwrap();
    // Duplicate the sole block's id — must be rejected before touching disk.
    tpl.blocks.push(tpl.blocks[0].clone());
    assert!(matches!(
        vault.save_template(tpl).unwrap_err(),
        CoreError::DuplicateBlockId(_)
    ));
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn summary_reflects_pinned_meta_after_save() {
    let (vault, dir) = temp_vault();
    let mut note = vault.create_note("Pinnable").unwrap();
    // Fresh notes aren't pinned.
    assert!(!vault.note_summary(&note.id).unwrap().pinned);

    note.meta.pinned = true;
    vault.save_note(note.clone()).unwrap();
    assert!(vault.note_summary(&note.id).unwrap().pinned, "pin must surface in the summary");

    // Survives a reopen (rebuilt from the file's meta).
    let reopened = Vault::open(&dir).unwrap();
    assert!(reopened.note_summary(&note.id).unwrap().pinned);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn note_tags_surface_in_summary_and_survive_reopen() {
    let (vault, dir) = temp_vault();
    let note = vault.create_note("Taggable").unwrap();
    assert!(vault.note_summary(&note.id).unwrap().tags.is_empty());

    vault.add_note_tag(&note.id, "work").unwrap();
    vault.add_note_tag(&note.id, "  work  ").unwrap(); // trimmed dupe -> no-op
    vault.add_note_tag(&note.id, "urgent").unwrap();
    assert_eq!(
        vault.note_summary(&note.id).unwrap().tags,
        vec!["work".to_string(), "urgent".to_string()],
        "tags mirror into the summary, deduped/trimmed"
    );

    vault.remove_note_tag(&note.id, "work").unwrap();
    assert_eq!(vault.note_summary(&note.id).unwrap().tags, vec!["urgent".to_string()]);

    // set_note_tags replaces wholesale and cleans input.
    vault
        .set_note_tags(&note.id, vec!["  a ".into(), "b".into(), "a".into(), "".into()])
        .unwrap();
    assert_eq!(
        vault.note_summary(&note.id).unwrap().tags,
        vec!["a".to_string(), "b".to_string()]
    );

    // Survives a reopen (rebuilt from the file's meta).
    let reopened = Vault::open(&dir).unwrap();
    assert_eq!(
        reopened.note_summary(&note.id).unwrap().tags,
        vec!["a".to_string(), "b".to_string()]
    );

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn note_properties_round_trip_and_mirror_to_summary() {
    let (vault, dir) = temp_vault();
    let note = vault.create_note("Project").unwrap();
    assert!(vault.note_summary(&note.id).unwrap().properties.is_empty());

    // Set two opaque values (a select option id and a date string).
    vault
        .set_note_property(&note.id, "status", Some(serde_json::json!("in-progress")))
        .unwrap();
    vault
        .set_note_property(&note.id, "deadline", Some(serde_json::json!("2026-09-01")))
        .unwrap();

    let props = vault.note_summary(&note.id).unwrap().properties;
    assert_eq!(props.get("status"), Some(&serde_json::json!("in-progress")));
    assert_eq!(props.get("deadline"), Some(&serde_json::json!("2026-09-01")));

    // Clearing removes just that key.
    vault.set_note_property(&note.id, "status", None).unwrap();
    let props = vault.note_summary(&note.id).unwrap().properties;
    assert!(!props.contains_key("status"));
    assert!(props.contains_key("deadline"));

    // Survives a reopen (rebuilt from the file's meta).
    let reopened = Vault::open(&dir).unwrap();
    assert_eq!(
        reopened.note_summary(&note.id).unwrap().properties.get("deadline"),
        Some(&serde_json::json!("2026-09-01"))
    );

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn summary_carries_created_and_nonzero_size() {
    let (vault, dir) = temp_vault();
    let note = vault.create_note("Sized").unwrap();
    let summary = vault.note_summary(&note.id).unwrap();
    assert_eq!(summary.created, note.created, "created mirrors the note");
    assert!(summary.size > 0, "size is the note file's byte length");

    // Size self-heals on reopen (recomputed from disk during the walk).
    let reopened = Vault::open(&dir).unwrap();
    assert!(reopened.note_summary(&note.id).unwrap().size > 0);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn note_date_surfaces_in_summary_and_range_query_without_disk_read() {
    let (vault, dir) = temp_vault();
    let note = vault.create_note("Meeting notes").unwrap();
    let d = NaiveDate::from_ymd_opt(2026, 7, 15).unwrap();

    vault
        .add_note_date(&note.id, NoteDate { date: d, event_id: None })
        .unwrap();

    // Mirrored into the in-memory summary, exactly like `pinned`.
    assert_eq!(vault.note_summary(&note.id).unwrap().dates, vec![NoteDate { date: d, event_id: None }]);

    // A range query is served from the index (this vault's notes/ dir could be
    // deleted from under us and the in-memory answer would still stand).
    let hits = vault.notes_in_date_range(
        NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
        NaiveDate::from_ymd_opt(2026, 7, 31).unwrap(),
    );
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].note_id, note.id);
    assert_eq!(hits[0].date, d);

    // A date outside the range doesn't match.
    assert!(vault
        .notes_in_date_range(
            NaiveDate::from_ymd_opt(2026, 8, 1).unwrap(),
            NaiveDate::from_ymd_opt(2026, 8, 31).unwrap(),
        )
        .is_empty());

    // Survives a reopen (rebuilt from the file's meta — round-trips on disk).
    let reopened = Vault::open(&dir).unwrap();
    assert_eq!(reopened.note_summary(&note.id).unwrap().dates, vec![NoteDate { date: d, event_id: None }]);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn old_dateless_note_file_still_loads() {
    // A pre-Phase-3 note file has no `meta.dates` key at all. serde's default
    // must load it with an empty `dates` (no SCHEMA_VERSION bump needed).
    let (vault, dir) = temp_vault();
    let note = vault.create_note("Legacy").unwrap();
    let path = dir.join(vault.note_summary(&note.id).unwrap().path);

    // Rewrite the file's meta WITHOUT a `dates` field, as an old build would.
    let mut raw: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    raw["meta"] = serde_json::json!({ "pinned": false, "tags": [] });
    fs::write(&path, serde_json::to_string(&raw).unwrap()).unwrap();

    let reopened = Vault::open(&dir).unwrap();
    let loaded = reopened.read_note(&note.id).unwrap();
    assert!(loaded.meta.dates.is_empty());
    assert!(reopened.note_summary(&note.id).unwrap().dates.is_empty());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn create_note_in_writes_directly_to_the_target_folder() {
    let (vault, dir) = temp_vault();
    vault.create_folder("Biology").unwrap();
    let note = vault.create_note_in("Cell", "Biology").unwrap();

    let summary = vault
        .list_notes()
        .unwrap()
        .into_iter()
        .find(|s| s.id == note.id)
        .unwrap();
    assert!(summary.path.contains("Biology/"));
    assert!(dir.join("notes/Biology/cell.json").exists());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn import_icon_copies_into_attachments_icons_and_handles_collisions() {
    let (vault, dir) = temp_vault();

    let src_dir = std::env::temp_dir().join(format!("tundra-icon-src-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&src_dir).unwrap();
    let src = src_dir.join("sprout.png");
    fs::write(&src, b"not a real png, just bytes").unwrap();

    let rel = vault.import_icon(&src).unwrap();
    assert_eq!(rel, "attachments/icons/sprout.png");
    assert!(dir.join(&rel).exists());
    assert_eq!(fs::read(dir.join(&rel)).unwrap(), b"not a real png, just bytes");

    // Importing the same file name again doesn't clobber the first copy.
    let rel2 = vault.import_icon(&src).unwrap();
    assert_eq!(rel2, "attachments/icons/sprout-2.png");
    assert!(dir.join(&rel).exists());
    assert!(dir.join(&rel2).exists());

    std::fs::remove_dir_all(&src_dir).ok();
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn import_banner_reads_from_disk_into_content_addressed_images() {
    let (vault, dir) = temp_vault();

    let src_dir = std::env::temp_dir().join(format!("tundra-banner-src-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&src_dir).unwrap();
    let src = src_dir.join("cover.jpg");
    fs::write(&src, b"pretend jpeg bytes").unwrap();

    // Lands in the shared image library (content-addressed), not a
    // banner-specific folder — same store as editor image embeds.
    let rel = vault.import_banner(&src).unwrap();
    assert!(rel.starts_with("attachments/images/"));
    assert!(rel.ends_with(".jpg"));
    assert!(dir.join(&rel).exists());
    assert_eq!(fs::read(dir.join(&rel)).unwrap(), b"pretend jpeg bytes");

    // Identical bytes dedupe to the same path (content addressing).
    let rel2 = vault.import_banner(&src).unwrap();
    assert_eq!(rel, rel2);

    std::fs::remove_dir_all(&src_dir).ok();
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn import_attachment_from_path_reads_disk_bytes_by_kind() {
    let (vault, dir) = temp_vault();

    let src_dir = std::env::temp_dir().join(format!("tundra-import-attach-src-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&src_dir).unwrap();
    let src = src_dir.join("diagram.png");
    fs::write(&src, b"pretend png bytes").unwrap();

    let rel = vault.import_attachment_from_path(AttachmentKind::Image, &src).unwrap();
    assert!(rel.starts_with("attachments/images/"));
    assert!(rel.ends_with(".png"));
    assert!(dir.join(&rel).exists());
    assert_eq!(fs::read(dir.join(&rel)).unwrap(), b"pretend png bytes");

    // Same content-addressing guarantee as import_attachment: re-copying the
    // same source file dedupes to the identical path.
    let rel2 = vault.import_attachment_from_path(AttachmentKind::Image, &src).unwrap();
    assert_eq!(rel, rel2);

    std::fs::remove_dir_all(&src_dir).ok();
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn import_attachment_is_content_addressed_sharded_and_dedupes() {
    let (vault, dir) = temp_vault();

    let png = b"\x89PNG fake image bytes";
    let rel = vault.import_attachment(AttachmentKind::Image, "photo.png", png).unwrap();

    // Sharded under attachments/images/<first 2 hex of hash>/<hash>.png.
    let hex = blake3::hash(png).to_hex();
    let expected = format!("attachments/images/{}/{}.png", &hex[..2], hex);
    assert_eq!(rel, expected);

    // The returned path round-trips to a real file holding exactly the bytes.
    assert_eq!(fs::read(dir.join(&rel)).unwrap(), png);

    // Same content (even via a different original filename) dedupes to the
    // very same path, and does not create a second file in the shard dir.
    let rel2 = vault
        .import_attachment(AttachmentKind::Image, "renamed.png", png)
        .unwrap();
    assert_eq!(rel2, rel);
    let shard_dir = dir.join(format!("attachments/images/{}", &hex[..2]));
    let count = fs::read_dir(&shard_dir).unwrap().count();
    assert_eq!(count, 1, "identical content must not create a second file");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn import_attachment_distinct_content_gets_distinct_paths_and_kinds() {
    let (vault, dir) = temp_vault();

    let a = vault.import_attachment(AttachmentKind::Image, "a.png", b"aaaa").unwrap();
    let b = vault.import_attachment(AttachmentKind::Image, "b.png", b"bbbb").unwrap();
    assert_ne!(a, b, "different bytes must hash to different paths");

    // Kind selects the library subdirectory.
    let vid = vault.import_attachment(AttachmentKind::Video, "clip.mp4", b"movie").unwrap();
    let file = vault.import_attachment(AttachmentKind::File, "doc.pdf", b"%PDF").unwrap();
    assert!(vid.starts_with("attachments/videos/"));
    assert!(file.starts_with("attachments/files/"));
    assert!(dir.join(&vid).exists());
    assert!(dir.join(&file).exists());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn import_attachment_handles_a_missing_extension() {
    let (vault, dir) = temp_vault();
    let rel = vault.import_attachment(AttachmentKind::File, "READ ME", b"data").unwrap();
    let hex = blake3::hash(b"data").to_hex();
    assert_eq!(rel, format!("attachments/files/{}/{}", &hex[..2], hex));
    assert!(dir.join(&rel).exists());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn creating_an_unrelated_folder_does_not_move_existing_root_notes() {
    let (vault, dir) = temp_vault();
    let a = vault.create_note("Alpha").unwrap();
    let b = vault.create_note("Beta").unwrap();
    let c = vault.create_note("Gamma").unwrap();

    vault.create_folder("Brand New Folder").unwrap();

    let notes = vault.list_notes().unwrap();
    for (id, title) in [(&a.id, "Alpha"), (&b.id, "Beta"), (&c.id, "Gamma")] {
        let summary = notes.iter().find(|s| &s.id == id).unwrap_or_else(|| panic!("{title} missing after folder create"));
        assert_eq!(
            summary.path,
            format!("notes/{}.json", title.to_lowercase()),
            "{title} should still be at the root, not moved into the new folder"
        );
    }

    let tree = vault.list_tree();
    let new_folder = tree
        .iter()
        .find_map(|n| match n {
            TreeNode::Folder(f) if f.name == "Brand New Folder" => Some(f),
            _ => None,
        })
        .expect("new folder present in tree");
    assert!(
        new_folder.children.is_empty(),
        "new folder should be empty, but contains: {:?}",
        new_folder.children
    );

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn read_note_migrates_a_v1_string_content_file_on_disk() {
    // A Phase 0 note file written straight to disk (schemaVersion 1, with a
    // paragraph whose `content` is a raw string). Reading it must upgrade it
    // to the current shape with the text preserved — not discarded.
    // `temp_vault` lays down the `notes/` dir; we then drop a legacy file in
    // it and re-open so the index picks the hand-written note up.
    let (_seed, dir) = temp_vault();
    let path = dir.join("notes/legacy.json");
    let legacy = serde_json::json!({
        "schemaVersion": 1,
        "id": "11111111-1111-1111-1111-111111111111",
        "title": "Legacy",
        "created": "2026-07-01T10:00:00Z",
        "modified": "2026-07-01T10:00:00Z",
        "meta": { "pinned": false, "tags": [] },
        "blocks": [
            { "id": "b1", "type": "paragraph", "content": "hello\n# world" }
        ]
    });
    fs::write(&path, serde_json::to_vec_pretty(&legacy).unwrap()).unwrap();

    // Rebuild the index so the vault knows about the hand-written file.
    let vault = Vault::open(&dir).unwrap();
    let note = vault.read_note("11111111-1111-1111-1111-111111111111").unwrap();

    assert_eq!(note.schema_version, SCHEMA_VERSION);
    assert_eq!(
        note.blocks[0].content.as_ref().unwrap(),
        &serde_json::json!([{ "type": "text", "text": "hello\n# world", "styles": {} }]),
        "the legacy string text must be preserved as an inline text node"
    );
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn quick_note_is_a_singleton_scratchpad_outside_the_notes_tree() {
    let (vault, dir) = temp_vault();

    // Before anything is written, reading yields a fresh empty scratchpad
    // (not persisted yet — no file on disk).
    let fresh = vault.read_quick_note().unwrap();
    assert!(!dir.join("quicknote.json").exists());

    // Save some content; it round-trips from its own file at the vault root.
    let mut edited = fresh.clone();
    edited.blocks = vec![Block {
        id: "b1".into(),
        block_type: "paragraph".into(),
        props: None,
        content: Some(serde_json::json!([{ "type": "text", "text": "an idea", "styles": {} }])),
        children: vec![],
    }];
    vault.save_quick_note(edited.clone()).unwrap();
    assert!(dir.join("quicknote.json").is_file());
    let reread = vault.read_quick_note().unwrap();
    assert_eq!(reread.blocks[0].content, edited.blocks[0].content);

    // Crucially it is NOT a vault note: absent from list_notes and the tree,
    // so it never clutters nav / search / the graph.
    assert!(vault.list_notes().unwrap().is_empty());
    assert!(vault.list_tree().is_empty());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn config_round_trips_and_rejects_traversal() {
    let (vault, dir) = temp_vault();

    // Missing config reads as None (not an error).
    assert!(vault.read_config("graph-view.json").unwrap().is_none());

    // Write then read back the exact contents, landing under .vault/config/.
    vault
        .write_config("graph-view.json", r#"{"ratio":1.5}"#)
        .unwrap();
    assert_eq!(
        vault.read_config("graph-view.json").unwrap().as_deref(),
        Some(r#"{"ratio":1.5}"#)
    );
    assert!(dir.join(".vault/config/graph-view.json").is_file());

    // Overwrite is atomic and replaces cleanly.
    vault.write_config("graph-view.json", "{}").unwrap();
    assert_eq!(vault.read_config("graph-view.json").unwrap().as_deref(), Some("{}"));

    // A name that tries to escape the config dir is rejected, on read AND write.
    for bad in ["../secret", "a/b", "..", "", ".\\evil"] {
        assert!(vault.read_config(bad).is_err(), "read must reject {bad:?}");
        assert!(vault.write_config(bad, "x").is_err(), "write must reject {bad:?}");
    }

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn reconcile_path_picks_up_an_external_modify() {
    let (vault, dir) = temp_vault();
    let note = vault.create_note("Fern").unwrap();
    let path = dir.join("notes/fern.json");

    // Simulate an external editor changing the title on disk directly
    // (bypassing the vault entirely, so this is NOT a self-write).
    let mut on_disk: Note = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    on_disk.title = "Fern (edited externally)".to_string();
    fs::write(&path, serde_json::to_vec_pretty(&on_disk).unwrap()).unwrap();

    let events = vault.reconcile_path(&path);
    assert!(events.contains(&ChangeEvent::TreeChanged));
    assert!(events.contains(&ChangeEvent::NoteChangedExternally { id: note.id.clone() }));

    let summary = vault.list_notes().unwrap().into_iter().find(|s| s.id == note.id).unwrap();
    assert_eq!(summary.title, "Fern (edited externally)");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn reconcile_path_picks_up_an_external_delete() {
    let (vault, dir) = temp_vault();
    let note = vault.create_note("Moss").unwrap();
    let path = dir.join("notes/moss.json");

    fs::remove_file(&path).unwrap(); // external delete, not through the vault

    let events = vault.reconcile_path(&path);
    assert!(events.contains(&ChangeEvent::TreeChanged));
    assert!(events.contains(&ChangeEvent::NoteChangedExternally { id: note.id.clone() }));
    assert!(vault.read_note(&note.id).is_err());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn reconcile_path_ignores_non_json_artifacts() {
    let (vault, dir) = temp_vault();
    let stray = dir.join("notes/leftover.tmp");
    fs::write(&stray, b"partial write").unwrap();

    assert_eq!(vault.reconcile_path(&stray), Vec::new());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn reconcile_path_tracks_externally_created_and_removed_folders() {
    let (vault, dir) = temp_vault();
    let folder_path = dir.join("notes/External Folder");
    fs::create_dir_all(&folder_path).unwrap(); // external mkdir, not through the vault

    let events = vault.reconcile_path(&folder_path);
    assert_eq!(events, vec![ChangeEvent::TreeChanged]);
    let tree = vault.list_tree();
    assert!(tree
        .iter()
        .any(|n| matches!(n, TreeNode::Folder(f) if f.name == "External Folder")));

    fs::remove_dir_all(&folder_path).unwrap(); // external rmdir
    let events = vault.reconcile_path(&folder_path);
    assert_eq!(events, vec![ChangeEvent::TreeChanged]);
    let tree = vault.list_tree();
    assert!(!tree
        .iter()
        .any(|n| matches!(n, TreeNode::Folder(f) if f.name == "External Folder")));

    std::fs::remove_dir_all(&dir).ok();
}
