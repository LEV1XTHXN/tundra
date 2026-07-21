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
mod tests;
