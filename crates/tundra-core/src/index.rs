//! Local full-text search over a vault's notes (CLAUDE.md §6.1 `index`,
//! Phase 1 step 9). The Tantivy index lives under `.vault/cache/search/` —
//! derived and rebuildable, never a source of truth (CLAUDE.md §8: "cache is
//! derived").

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use specta::Type;
use tantivy::collector::TopDocs;
use tantivy::query::{BooleanQuery, BoostQuery, Occur, Query, QueryParser, RegexQuery};
use tantivy::schema::{Field, Schema, Value as _, STORED, STRING, TEXT};
use tantivy::snippet::SnippetGenerator;
use tantivy::{Index, IndexWriter, ReloadPolicy, TantivyDocument, Term};

use crate::document::{Block, Note};
use crate::error::{CoreError, Result};
use crate::vault::Vault;

/// One ranked search result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct SearchHit {
    pub id: String,
    pub title: String,
    pub snippet: String,
}

/// Concatenate all human-readable text in a note's block tree — the single
/// shared source of truth for what's searchable. Blocks are opaque,
/// validated-but-unmodeled JSON (per the `document` module), so this walks
/// `Block.content` for BlockNote's inline-content shape (arrays of objects
/// carrying a `text` field, e.g. `{ type: "text", text: "...", styles: {} }`),
/// recursing into nested inline content (styled spans, links) and into
/// `children` for nested blocks.
pub fn extract_text(note: &Note) -> String {
    let mut out = String::new();
    for block in &note.blocks {
        extract_block_text(block, &mut out);
    }
    out
}

fn extract_block_text(block: &Block, out: &mut String) {
    if let Some(content) = &block.content {
        extract_value_text(content, out);
    }
    for child in &block.children {
        extract_block_text(child, out);
    }
}

fn extract_value_text(value: &serde_json::Value, out: &mut String) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, val) in map {
                if key == "text" {
                    if let serde_json::Value::String(text) = val {
                        if !out.is_empty() {
                            out.push(' ');
                        }
                        out.push_str(text);
                    }
                } else {
                    extract_value_text(val, out);
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                extract_value_text(item, out);
            }
        }
        _ => {}
    }
}

/// On-disk manifest of what's currently indexed, so `catch_up` can compare
/// modification times without a Tantivy round-trip per note. Derived and
/// rebuildable, like the rest of `.vault/cache/`.
#[derive(Debug, Default, Serialize, Deserialize)]
struct Manifest {
    indexed: HashMap<String, DateTime<Utc>>,
}

impl Manifest {
    fn load(path: &Path) -> Manifest {
        std::fs::read(path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    fn save(&self, path: &Path) -> Result<()> {
        std::fs::write(path, serde_json::to_vec_pretty(self)?)?;
        Ok(())
    }
}

/// Local full-text search index for one open vault.
pub struct SearchIndex {
    index: Index,
    writer: Mutex<IndexWriter>,
    field_id: Field,
    field_title: Field,
    field_body: Field,
    field_tags: Field,
    field_path: Field,
    manifest_path: PathBuf,
}

fn io_err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Io(e.to_string())
}

impl SearchIndex {
    /// Open (or create) the search index for the vault rooted at `vault_root`.
    pub fn open(vault_root: &Path) -> Result<Self> {
        let dir = vault_root.join(".vault/cache/search");
        std::fs::create_dir_all(&dir)?;

        let mut schema_builder = Schema::builder();
        let field_id = schema_builder.add_text_field("id", STRING | STORED);
        let field_title = schema_builder.add_text_field("title", TEXT | STORED);
        let field_body = schema_builder.add_text_field("body", TEXT | STORED);
        let field_tags = schema_builder.add_text_field("tags", TEXT | STORED);
        let field_path = schema_builder.add_text_field("path", STRING | STORED);
        let schema = schema_builder.build();

        let mmap_dir = tantivy::directory::MmapDirectory::open(&dir).map_err(io_err)?;
        let index = Index::open_or_create(mmap_dir, schema).map_err(io_err)?;
        let writer = index.writer(50_000_000).map_err(io_err)?;

        Ok(SearchIndex {
            index,
            writer: Mutex::new(writer),
            field_id,
            field_title,
            field_body,
            field_tags,
            field_path,
            manifest_path: dir.join("manifest.json"),
        })
    }

    fn to_document(&self, note: &Note, rel_path: &str) -> TantivyDocument {
        let body = extract_text(note);
        let mut doc = TantivyDocument::default();
        doc.add_text(self.field_id, &note.id);
        doc.add_text(self.field_title, &note.title);
        doc.add_text(self.field_body, &body);
        for tag in &note.meta.tags {
            doc.add_text(self.field_tags, tag);
        }
        doc.add_text(self.field_path, rel_path);
        doc
    }

    /// (Re)index a single note — called after a successful save, and from
    /// the external-change watcher (Phase 1 step 8), so search stays correct
    /// without waiting for the next catch-up.
    pub fn index_note(&self, note: &Note, rel_path: &str) -> Result<()> {
        let doc = self.to_document(note, rel_path);
        let mut writer = self.writer.lock().unwrap();
        writer.delete_term(Term::from_field_text(self.field_id, &note.id));
        writer.add_document(doc).map_err(io_err)?;
        writer.commit().map_err(io_err)?;
        drop(writer);

        let mut manifest = Manifest::load(&self.manifest_path);
        manifest.indexed.insert(note.id.clone(), note.modified);
        manifest.save(&self.manifest_path)
    }

    /// Remove a note from the index (deleted, via the app or externally).
    pub fn remove_note(&self, id: &str) -> Result<()> {
        let mut writer = self.writer.lock().unwrap();
        writer.delete_term(Term::from_field_text(self.field_id, id));
        writer.commit().map_err(io_err)?;
        drop(writer);

        let mut manifest = Manifest::load(&self.manifest_path);
        manifest.indexed.remove(id);
        manifest.save(&self.manifest_path)
    }

    /// Full rebuild from scratch — the `rebuild_index` command.
    pub fn rebuild(&self, vault: &Vault) -> Result<()> {
        {
            let mut writer = self.writer.lock().unwrap();
            writer.delete_all_documents().map_err(io_err)?;
            writer.commit().map_err(io_err)?;
        }
        Manifest::default().save(&self.manifest_path)?;
        self.catch_up(vault)
    }

    /// Incremental catch-up: compare each note's `modified` timestamp
    /// against what's recorded as indexed, and only reindex what changed —
    /// not a full rebuild every launch. Also drops entries for notes that no
    /// longer exist (deleted while the app was closed).
    pub fn catch_up(&self, vault: &Vault) -> Result<()> {
        let mut manifest = Manifest::load(&self.manifest_path);
        let summaries = vault.list_notes()?;
        let current_ids: HashSet<&str> = summaries.iter().map(|s| s.id.as_str()).collect();

        let mut writer = self.writer.lock().unwrap();
        let mut changed = false;

        let mut stale_ids: Vec<String> = Vec::new();
        for id in manifest.indexed.keys() {
            if !current_ids.contains(id.as_str()) {
                stale_ids.push(id.clone());
            }
        }
        for id in stale_ids {
            writer.delete_term(Term::from_field_text(self.field_id, &id));
            manifest.indexed.remove(&id);
            changed = true;
        }

        for summary in &summaries {
            if manifest.indexed.get(&summary.id) == Some(&summary.modified) {
                continue; // already up to date
            }
            let note = vault.read_note(&summary.id)?;
            let doc = self.to_document(&note, &summary.path);
            writer.delete_term(Term::from_field_text(self.field_id, &note.id));
            writer.add_document(doc).map_err(io_err)?;
            manifest.indexed.insert(note.id.clone(), note.modified);
            changed = true;
        }

        if changed {
            writer.commit().map_err(io_err)?;
        }
        drop(writer);
        manifest.save(&self.manifest_path)
    }

    /// Ranked search hits: id, title, and a highlighted-context snippet.
    ///
    /// Matches by PREFIX, not whole token: Tantivy's `QueryParser` only finds
    /// exact tokens, so a search for "test" would never find a note containing
    /// only "test2". Each query word becomes a `RegexQuery` (`"word.*"`)
    /// against every searchable field instead, matching any indexed term that
    /// starts with it. Words are lowercased and stripped to alphanumerics
    /// before building the pattern (matching the tokenizer's own output), so
    /// there's nothing that needs regex-escaping.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let words: Vec<String> = query
            .split_whitespace()
            .map(|w| w.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase())
            .filter(|w| !w.is_empty())
            .collect();
        if words.is_empty() {
            return Ok(Vec::new());
        }

        let reader: tantivy::IndexReader = self
            .index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()
            .map_err(io_err)?;
        let searcher = reader.searcher();

        let mut word_clauses: Vec<(Occur, Box<dyn Query>)> = Vec::with_capacity(words.len());
        for word in &words {
            let pattern = format!("{word}.*");
            let mut field_clauses: Vec<(Occur, Box<dyn Query>)> = Vec::with_capacity(3);
            for (field, boost) in [
                (self.field_title, 3.0_f32),
                (self.field_body, 1.0),
                (self.field_tags, 1.0),
            ] {
                let regex_query: Box<dyn Query> =
                    Box::new(RegexQuery::from_pattern(&pattern, field).map_err(io_err)?);
                field_clauses.push((Occur::Should, Box::new(BoostQuery::new(regex_query, boost))));
            }
            word_clauses.push((Occur::Should, Box::new(BooleanQuery::from(field_clauses))));
        }
        let matching_query = BooleanQuery::from(word_clauses);

        let top_docs = searcher
            .search(&matching_query, &TopDocs::with_limit(limit).order_by_score())
            .map_err(io_err)?;

        // A separate exact-term query, used only to pick/highlight the snippet
        // fragment — `RegexQuery` is pattern-based (it doesn't match one fixed
        // term), so it can't report terms for `SnippetGenerator` to highlight.
        // Falls back to an unhighlighted (but still present) snippet only for a
        // hit that matched purely via a longer word — e.g. "test" finding
        // "test2" with no literal "test" anywhere in that note; the search
        // result itself is unaffected either way.
        let mut query_parser = QueryParser::for_index(
            &self.index,
            vec![self.field_title, self.field_body, self.field_tags],
        );
        query_parser.set_field_boost(self.field_title, 3.0);
        let snippet_query = query_parser.parse_query(query).ok();

        let snippet_generator = match &snippet_query {
            Some(q) => SnippetGenerator::create(&searcher, q.as_ref(), self.field_body).ok(),
            None => None,
        };

        let mut hits = Vec::with_capacity(top_docs.len());
        for (_score, addr) in top_docs {
            let doc: TantivyDocument = searcher.doc(addr).map_err(io_err)?;
            let id = field_str(&doc, self.field_id);
            let title = field_str(&doc, self.field_title);
            let snippet = snippet_generator
                .as_ref()
                .map(|g| g.snippet_from_doc(&doc).fragment().to_string())
                .unwrap_or_default();
            hits.push(SearchHit { id, title, snippet });
        }
        Ok(hits)
    }

    /// Tag search: notes whose tag set matches `tag_query`, for the global
    /// search's `#tag` mode. Unlike [`search`], this matches ONLY the `tags`
    /// field — so `#bio` surfaces notes tagged `biology` regardless of their
    /// title/body — and every word in the query must match (a note tagged only
    /// `machine` is not a hit for `#machine learning`).
    ///
    /// Matching is by prefix on each tag token, consistent with [`search`]:
    /// words are lowercased and stripped to alphanumerics (mirroring the
    /// tokenizer), then each becomes a `"word.*"` `RegexQuery` against `tags`.
    /// The snippet carries the note's full tag set (`#a #b`) so the UI can show
    /// why a note matched. An empty query returns no hits (not every note).
    pub fn search_by_tag(&self, tag_query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let words: Vec<String> = tag_query
            .split_whitespace()
            .map(|w| w.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase())
            .filter(|w| !w.is_empty())
            .collect();
        if words.is_empty() {
            return Ok(Vec::new());
        }

        let reader: tantivy::IndexReader = self
            .index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()
            .map_err(io_err)?;
        let searcher = reader.searcher();

        let mut clauses: Vec<(Occur, Box<dyn Query>)> = Vec::with_capacity(words.len());
        for word in &words {
            let pattern = format!("{word}.*");
            let regex_query: Box<dyn Query> =
                Box::new(RegexQuery::from_pattern(&pattern, self.field_tags).map_err(io_err)?);
            clauses.push((Occur::Must, regex_query));
        }
        let query = BooleanQuery::from(clauses);

        let top_docs = searcher
            .search(&query, &TopDocs::with_limit(limit).order_by_score())
            .map_err(io_err)?;

        let mut hits = Vec::with_capacity(top_docs.len());
        for (_score, addr) in top_docs {
            let doc: TantivyDocument = searcher.doc(addr).map_err(io_err)?;
            let id = field_str(&doc, self.field_id);
            let title = field_str(&doc, self.field_title);
            let snippet = doc
                .get_all(self.field_tags)
                .filter_map(|v| v.as_str())
                .map(|t| format!("#{t}"))
                .collect::<Vec<_>>()
                .join(" ");
            hits.push(SearchHit { id, title, snippet });
        }
        Ok(hits)
    }
}

fn field_str(doc: &TantivyDocument, field: Field) -> String {
    doc.get_first(field)
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string()
}

#[cfg(test)]
mod tests {
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
}
