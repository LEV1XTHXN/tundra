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
mod tests;
