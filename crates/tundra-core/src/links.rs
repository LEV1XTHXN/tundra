//! Inter-note links & graph data (CLAUDE.md §6.1 `links`, Phase 2 step 2).
//!
//! A link is a **custom BlockNote inline content node** that stores the target
//! note's **UUID** (plus a display label captured at insertion). Identity is the
//! id, so links survive rename/move with **no repair step** — this module never
//! rewrites a referencing note. Backlinks and graph edges are **derived** data:
//! we walk each note's opaque block tree (the same traversal `index::extract_text`
//! uses), read each link node's `noteId` directly, and cache the id→targets map
//! under `.vault/cache/graph/` — rebuildable, never a source of truth
//! (CLAUDE.md §8: "cache is derived").
//!
//! Broken links (a stored id that no longer resolves to a note) are kept in the
//! raw map but dropped from graph edges and never crash a query — the frontend
//! renders them distinctly from the stored label.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;

use crate::document::{Block, Icon, Note, NoteSummary};
use crate::error::Result;
use crate::vault::Vault;

/// The `type` of the custom BlockNote inline content node that carries a note
/// link. The frontend's inline-content spec (Phase 2 step 3) MUST use this exact
/// string, storing the target id at `props.noteId` — that's the whole contract
/// this parser relies on.
pub const LINK_INLINE_TYPE: &str = "noteLink";

/// A graph node — one note.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct GraphNode {
    pub id: String,
    pub title: String,
    /// The note's own icon (set via the same picker as the nav tree) — carried
    /// through so the graph view can optionally render it in place of the
    /// default dot instead of re-deriving anything from the title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<Icon>,
}

/// A directed graph edge — note `source` links to note `target`. Only emitted
/// when both ends resolve to existing notes (broken links are not edges).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
}

/// The whole link graph for the vault: every note as a node, resolved links as
/// directed edges.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

/// Extract the note ids a note links to, in first-seen order, de-duplicated
/// (linking to the same target twice is one edge / one backlink). Walks the
/// opaque block content and nested children, reading each link node's stored
/// `noteId` directly — no title matching, no disambiguation (identity is the id).
pub fn extract_link_ids(note: &Note) -> Vec<String> {
    let mut ids = Vec::new();
    let mut seen = HashSet::new();
    for block in &note.blocks {
        collect_block_links(block, &mut ids, &mut seen);
    }
    ids
}

fn collect_block_links(block: &Block, ids: &mut Vec<String>, seen: &mut HashSet<String>) {
    if let Some(content) = &block.content {
        collect_value_links(content, ids, seen);
    }
    for child in &block.children {
        collect_block_links(child, ids, seen);
    }
}

fn collect_value_links(value: &Value, ids: &mut Vec<String>, seen: &mut HashSet<String>) {
    match value {
        Value::Object(map) => {
            if map.get("type").and_then(Value::as_str) == Some(LINK_INLINE_TYPE) {
                if let Some(nid) = map
                    .get("props")
                    .and_then(|p| p.get("noteId"))
                    .and_then(Value::as_str)
                {
                    if !nid.is_empty() && seen.insert(nid.to_string()) {
                        ids.push(nid.to_string());
                    }
                }
            }
            // Keep recursing regardless — link nodes can sit inside table cells,
            // nested inline content, etc.
            for val in map.values() {
                collect_value_links(val, ids, seen);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_value_links(item, ids, seen);
            }
        }
        _ => {}
    }
}

/// Derived, rebuildable cache of the link graph, persisted under
/// `.vault/cache/graph/graph.json`. `modified` mirrors `index`'s manifest so
/// `catch_up` can skip notes that haven't changed since they were last parsed,
/// instead of re-reading every note on each launch.
#[derive(Debug, Default, Serialize, Deserialize)]
struct GraphCache {
    /// note id -> its `modified` when its links were last computed.
    modified: HashMap<String, DateTime<Utc>>,
    /// note id -> the target ids it links to (raw; may include ids that no
    /// longer resolve — "broken" is decided at query time, not stored).
    out: HashMap<String, Vec<String>>,
}

/// The link index for one open vault. Mirrors `SearchIndex`'s lifecycle
/// (`open` + `catch_up`, per-note `index_note`/`remove_note`, and `rebuild`) so
/// the two derived indexes stay updated the same way from the command layer.
pub struct LinkIndex {
    cache_path: PathBuf,
    cache: RwLock<GraphCache>,
}

impl LinkIndex {
    /// Open (or create) the link index for the vault rooted at `vault_root`,
    /// loading whatever is cached (empty if missing/corrupt — it's rebuildable).
    pub fn open(vault_root: &Path) -> Result<Self> {
        let dir = vault_root.join(".vault/cache/graph");
        std::fs::create_dir_all(&dir)?;
        let cache_path = dir.join("graph.json");
        let cache = std::fs::read(&cache_path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        Ok(LinkIndex {
            cache_path,
            cache: RwLock::new(cache),
        })
    }

    fn persist(&self, cache: &GraphCache) -> Result<()> {
        std::fs::write(&self.cache_path, serde_json::to_vec_pretty(cache)?)?;
        Ok(())
    }

    /// (Re)compute one note's outgoing links — called after a successful save,
    /// and from the external-change watcher, so backlinks/graph stay current
    /// without waiting for the next catch-up.
    pub fn index_note(&self, note: &Note) -> Result<()> {
        let targets = extract_link_ids(note);
        let mut cache = self.cache.write().unwrap();
        if targets.is_empty() {
            cache.out.remove(&note.id);
        } else {
            cache.out.insert(note.id.clone(), targets);
        }
        cache.modified.insert(note.id.clone(), note.modified);
        let snapshot = clone_cache(&cache);
        drop(cache);
        self.persist(&snapshot)
    }

    /// Drop a note's own outgoing links (it was deleted). Incoming links from
    /// *other* notes are intentionally left untouched — we never rewrite a
    /// referencing note; those simply become broken links, filtered out of
    /// edges at query time.
    pub fn remove_note(&self, id: &str) -> Result<()> {
        let mut cache = self.cache.write().unwrap();
        cache.out.remove(id);
        cache.modified.remove(id);
        let snapshot = clone_cache(&cache);
        drop(cache);
        self.persist(&snapshot)
    }

    /// Incremental catch-up: recompute links only for notes whose `modified`
    /// changed since they were last parsed, and forget notes that no longer
    /// exist. Reads no note files on a warm cache.
    pub fn catch_up(&self, vault: &Vault) -> Result<()> {
        let summaries = vault.list_notes()?;
        let current: HashSet<&str> = summaries.iter().map(|s| s.id.as_str()).collect();

        let mut cache = self.cache.write().unwrap();

        // Forget notes deleted while the app was closed.
        let stale: Vec<String> = cache
            .modified
            .keys()
            .filter(|id| !current.contains(id.as_str()))
            .cloned()
            .collect();
        for id in stale {
            cache.out.remove(&id);
            cache.modified.remove(&id);
        }

        // Reparse only what changed.
        for summary in &summaries {
            if cache.modified.get(&summary.id) == Some(&summary.modified) {
                continue;
            }
            let note = vault.read_note(&summary.id)?;
            let targets = extract_link_ids(&note);
            if targets.is_empty() {
                cache.out.remove(&note.id);
            } else {
                cache.out.insert(note.id.clone(), targets);
            }
            cache.modified.insert(note.id.clone(), note.modified);
        }

        let snapshot = clone_cache(&cache);
        drop(cache);
        self.persist(&snapshot)
    }

    /// Full rebuild from scratch — the recovery command (the graph cache is
    /// derived, never a source of truth).
    pub fn rebuild(&self, vault: &Vault) -> Result<()> {
        {
            let mut cache = self.cache.write().unwrap();
            *cache = GraphCache::default();
        }
        self.catch_up(vault)
    }

    /// Notes that link *to* `id` (incoming links), as current summaries. A
    /// reverse scan of the cached outgoing map; only sources that still exist
    /// are returned. Sorted by title for a stable backlinks panel.
    pub fn backlinks(&self, vault: &Vault, id: &str) -> Vec<NoteSummary> {
        let cache = self.cache.read().unwrap();
        let mut out: Vec<NoteSummary> = cache
            .out
            .iter()
            .filter(|(source, targets)| source.as_str() != id && targets.iter().any(|t| t == id))
            .filter_map(|(source, _)| vault.note_summary(source))
            .collect();
        out.sort_by(|a, b| a.title.cmp(&b.title).then_with(|| a.id.cmp(&b.id)));
        out
    }

    /// The whole directed graph: every current note as a node, and every link
    /// whose **both** ends resolve to existing notes as an edge (broken links
    /// dropped).
    pub fn graph_data(&self, vault: &Vault) -> Result<GraphData> {
        let summaries = vault.list_notes()?;
        let exists: HashSet<&str> = summaries.iter().map(|s| s.id.as_str()).collect();

        let nodes = summaries
            .iter()
            .map(|s| GraphNode {
                id: s.id.clone(),
                title: s.title.clone(),
                icon: s.icon.clone(),
            })
            .collect();

        let cache = self.cache.read().unwrap();
        let mut edges = Vec::new();
        for (source, targets) in &cache.out {
            if !exists.contains(source.as_str()) {
                continue;
            }
            for target in targets {
                if exists.contains(target.as_str()) {
                    edges.push(GraphEdge {
                        source: source.clone(),
                        target: target.clone(),
                    });
                }
            }
        }
        // Deterministic ordering (HashMap iteration is not).
        edges.sort_by(|a, b| a.source.cmp(&b.source).then_with(|| a.target.cmp(&b.target)));

        Ok(GraphData { nodes, edges })
    }

    /// Resolve a set of note ids to their **current** summaries (title/icon) —
    /// for live link labels. Ids that no longer resolve are omitted; the
    /// frontend falls back to each link's stored label for those.
    pub fn resolve_titles(&self, vault: &Vault, ids: &[String]) -> Vec<NoteSummary> {
        ids.iter().filter_map(|id| vault.note_summary(id)).collect()
    }
}

fn clone_cache(cache: &GraphCache) -> GraphCache {
    GraphCache {
        modified: cache.modified.clone(),
        out: cache.out.clone(),
    }
}

#[cfg(test)]
mod tests {
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
}
