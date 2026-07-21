//! Kanban: user-curated boards of notes (Phase 3+).
//!
//! A Kanban board is a *view* onto notes (like the calendar or quick notes), not
//! a block inside a note. Each board has ordered **columns** (rows); each column
//! has a name, an ordered list of the note ids the user has placed in it, and an
//! optional **tag**. The tag is the bridge to the note-level tag system: dropping
//! a note into a tagged column adds that tag to the note; moving it out removes
//! it. Membership is *explicit* — a board only ever shows notes the user added to
//! it, never the whole vault.
//!
//! Boards persist to `.vault/config/kanban.json` via the vault's atomic
//! `write_config` — it is *content* (backed up, MAY sync), deliberately NOT under
//! the rebuildable `.vault/cache/`, exactly like the calendar event store.
//!
//! Card note ids are stored raw; a card whose note was since deleted is a
//! dangling id that the frontend simply drops when it resolves cards to titles
//! (via `resolve_titles`). The board file is not eagerly pruned — the id is
//! harmless and reappears correctly if the note is restored.

use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;

use crate::error::Result;
use crate::vault::Vault;

/// The in-vault file (under `.vault/config/`) holding all boards. Content, not
/// cache — included in backups and MAY sync.
const KANBAN_FILE: &str = "kanban.json";

/// One column (row) in a board: a name, the notes placed in it (ordered), and an
/// optional tag that is auto-applied/removed as cards enter/leave the column.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct KanbanColumn {
    pub id: String,
    pub name: String,
    /// The tag auto-assigned to notes dropped here (and removed when they leave).
    /// `None` means this column has no tag automation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    /// Ordered note ids placed in this column. A note appears at most once per
    /// board (adding it to a second column moves it).
    #[serde(default)]
    pub note_ids: Vec<String>,
}

/// A single Kanban board: a name and its ordered columns. Boards are switched
/// between as tabs in the one Kanban view.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct KanbanBoard {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub columns: Vec<KanbanColumn>,
}

impl KanbanBoard {
    /// Find the index of the column currently holding `note_id`, and the note's
    /// position within it.
    fn locate(&self, note_id: &str) -> Option<(usize, usize)> {
        for (ci, col) in self.columns.iter().enumerate() {
            if let Some(pi) = col.note_ids.iter().position(|n| n == note_id) {
                return Some((ci, pi));
            }
        }
        None
    }
}

/// The tag change a card move implies: the (optional) tag to remove (the source
/// column's) and the (optional) tag to add (the destination column's). Applied
/// against the note *after* the board mutation is persisted.
#[derive(Debug, Default)]
struct TagDelta {
    remove: Option<String>,
    add: Option<String>,
}

impl TagDelta {
    /// From/to column tags collapse to a no-op when they're equal, so moving a
    /// card between two columns that share a tag doesn't churn the note.
    fn between(from: Option<String>, to: Option<String>) -> Self {
        if from == to {
            TagDelta::default()
        } else {
            TagDelta { remove: from, add: to }
        }
    }
}

/// The Kanban board store for one open vault — held in `AppState` alongside the
/// calendar/search/link indexes, replaced when a different vault opens. Boards
/// live in memory behind a lock and are written through the vault's atomic
/// `write_config` on every mutation.
#[derive(Debug, Default)]
pub struct KanbanStore {
    boards: RwLock<Vec<KanbanBoard>>,
}

impl KanbanStore {
    /// Load boards from `.vault/config/kanban.json`, or start empty.
    pub fn open(vault: &Vault) -> Result<Arc<Self>> {
        let boards = match vault.read_config(KANBAN_FILE)? {
            Some(raw) if !raw.trim().is_empty() => serde_json::from_str(&raw)?,
            _ => Vec::new(),
        };
        Ok(Arc::new(KanbanStore {
            boards: RwLock::new(boards),
        }))
    }

    /// All boards, in tab order.
    pub fn list(&self) -> Vec<KanbanBoard> {
        self.boards.read().unwrap().clone()
    }

    /// Create a board seeded with two empty, **untagged** bookend columns (Open /
    /// Closed) so it's immediately usable without assigning any tags; new columns
    /// are added between them. The new board is appended (becomes the last tab).
    /// Returns the full board list.
    pub fn create_board(&self, vault: &Vault, name: &str) -> Result<Vec<KanbanBoard>> {
        let name = clean_name(name, "New board");
        let board = KanbanBoard {
            id: Uuid::new_v4().to_string(),
            name,
            columns: ["Open", "Closed"]
                .iter()
                .map(|n| KanbanColumn {
                    id: Uuid::new_v4().to_string(),
                    name: (*n).to_string(),
                    tag: None,
                    note_ids: Vec::new(),
                })
                .collect(),
        };
        self.boards.write().unwrap().push(board);
        self.persist(vault)
    }

    /// Rename a board (no-op if unknown / blank name).
    pub fn rename_board(&self, vault: &Vault, board_id: &str, name: &str) -> Result<Vec<KanbanBoard>> {
        {
            let mut boards = self.boards.write().unwrap();
            if let Some(b) = boards.iter_mut().find(|b| b.id == board_id) {
                b.name = clean_name(name, &b.name.clone());
            }
        }
        self.persist(vault)
    }

    /// Delete a board and everything on it. Note **tags are left untouched** —
    /// deleting the board doesn't retro-strip tags a note earned while on it.
    pub fn delete_board(&self, vault: &Vault, board_id: &str) -> Result<Vec<KanbanBoard>> {
        self.boards.write().unwrap().retain(|b| b.id != board_id);
        self.persist(vault)
    }

    /// Append a new column to a board.
    pub fn add_column(
        &self,
        vault: &Vault,
        board_id: &str,
        name: &str,
        tag: Option<String>,
    ) -> Result<Vec<KanbanBoard>> {
        {
            let mut boards = self.boards.write().unwrap();
            if let Some(b) = boards.iter_mut().find(|b| b.id == board_id) {
                b.columns.push(KanbanColumn {
                    id: Uuid::new_v4().to_string(),
                    name: clean_name(name, "New column"),
                    tag: clean_tag(tag),
                    note_ids: Vec::new(),
                });
            }
        }
        self.persist(vault)
    }

    /// Rename a column and/or change its tag. Changing the tag does **not**
    /// retro-tag the cards already in the column — it only governs future
    /// drops/removals (kept deliberately simple; a bulk re-tag can come later).
    pub fn update_column(
        &self,
        vault: &Vault,
        board_id: &str,
        col_id: &str,
        name: &str,
        tag: Option<String>,
    ) -> Result<Vec<KanbanBoard>> {
        {
            let mut boards = self.boards.write().unwrap();
            if let Some(col) = boards
                .iter_mut()
                .find(|b| b.id == board_id)
                .and_then(|b| b.columns.iter_mut().find(|c| c.id == col_id))
            {
                col.name = clean_name(name, &col.name.clone());
                col.tag = clean_tag(tag);
            }
        }
        self.persist(vault)
    }

    /// Delete a column (and drop its cards from the board). Note tags are left
    /// as-is, consistent with `delete_board`.
    pub fn delete_column(&self, vault: &Vault, board_id: &str, col_id: &str) -> Result<Vec<KanbanBoard>> {
        {
            let mut boards = self.boards.write().unwrap();
            if let Some(b) = boards.iter_mut().find(|b| b.id == board_id) {
                b.columns.retain(|c| c.id != col_id);
            }
        }
        self.persist(vault)
    }

    /// Reorder a board's columns, moving the column at `col_id` to `to_index`.
    pub fn move_column(
        &self,
        vault: &Vault,
        board_id: &str,
        col_id: &str,
        to_index: usize,
    ) -> Result<Vec<KanbanBoard>> {
        {
            let mut boards = self.boards.write().unwrap();
            if let Some(b) = boards.iter_mut().find(|b| b.id == board_id) {
                if let Some(from) = b.columns.iter().position(|c| c.id == col_id) {
                    let col = b.columns.remove(from);
                    let to = to_index.min(b.columns.len());
                    b.columns.insert(to, col);
                }
            }
        }
        self.persist(vault)
    }

    /// Add a note to a column (at the end), applying that column's tag. If the
    /// note is already on this board it is *moved* here rather than duplicated.
    pub fn add_card(
        &self,
        vault: &Vault,
        board_id: &str,
        col_id: &str,
        note_id: &str,
    ) -> Result<Vec<KanbanBoard>> {
        self.place_card(vault, board_id, col_id, note_id, usize::MAX)
    }

    /// Move a note to `to_col_id` at `to_index` within the same board, applying
    /// the tag delta (remove the source column's tag, add the destination's).
    pub fn move_card(
        &self,
        vault: &Vault,
        board_id: &str,
        note_id: &str,
        to_col_id: &str,
        to_index: usize,
    ) -> Result<Vec<KanbanBoard>> {
        self.place_card(vault, board_id, to_col_id, note_id, to_index)
    }

    /// Shared add/move core: remove any existing occurrence of the note on the
    /// board, insert it into the destination column at `index` (clamped), then
    /// apply the implied tag delta to the note. Persists the board first so a
    /// crash can't leave a tag change without its board placement.
    fn place_card(
        &self,
        vault: &Vault,
        board_id: &str,
        to_col_id: &str,
        note_id: &str,
        index: usize,
    ) -> Result<Vec<KanbanBoard>> {
        let delta = {
            let mut boards = self.boards.write().unwrap();
            let Some(board) = boards.iter_mut().find(|b| b.id == board_id) else {
                drop(boards);
                return Ok(self.list());
            };

            // Where is it now (if anywhere), and remove it from there.
            let from_tag = board.locate(note_id).map(|(ci, pi)| {
                board.columns[ci].note_ids.remove(pi);
                board.columns[ci].tag.clone()
            });
            let from_tag = from_tag.flatten();

            let Some(to_col) = board.columns.iter_mut().find(|c| c.id == to_col_id) else {
                // Unknown destination: leave the note removed from its old column
                // rather than half-placing it — but that only happens on a bad id.
                drop(boards);
                return self.persist(vault);
            };
            let at = index.min(to_col.note_ids.len());
            to_col.note_ids.insert(at, note_id.to_string());
            TagDelta::between(from_tag, to_col.tag.clone())
        };

        let boards = self.persist(vault)?;
        self.apply_tag_delta(vault, note_id, &delta)?;
        Ok(boards)
    }

    /// Remove a note from a board entirely, stripping the tag of the column it
    /// was in (the reciprocal of adding it there).
    pub fn remove_card(&self, vault: &Vault, board_id: &str, note_id: &str) -> Result<Vec<KanbanBoard>> {
        let removed_tag = {
            let mut boards = self.boards.write().unwrap();
            boards
                .iter_mut()
                .find(|b| b.id == board_id)
                .and_then(|b| {
                    b.locate(note_id).map(|(ci, pi)| {
                        b.columns[ci].note_ids.remove(pi);
                        b.columns[ci].tag.clone()
                    })
                })
                .flatten()
        };

        let boards = self.persist(vault)?;
        if let Some(tag) = removed_tag {
            vault.remove_note_tag(note_id, &tag)?;
        }
        Ok(boards)
    }

    /// Apply a card move's tag delta to the note (remove old column's tag, add
    /// new column's), each a no-op when its tag is absent. The destination tag is
    /// **prepended** so the Kanban board tag always sorts before the note's other
    /// tags.
    fn apply_tag_delta(&self, vault: &Vault, note_id: &str, delta: &TagDelta) -> Result<()> {
        if let Some(tag) = &delta.remove {
            vault.remove_note_tag(note_id, tag)?;
        }
        if let Some(tag) = &delta.add {
            vault.prepend_note_tag(note_id, tag)?;
        }
        Ok(())
    }

    /// Serialize the current boards to the in-vault store file, atomically, and
    /// return the persisted list (so mutating commands hand the frontend the new
    /// authoritative state in one round trip).
    fn persist(&self, vault: &Vault) -> Result<Vec<KanbanBoard>> {
        let boards = self.boards.read().unwrap().clone();
        let json = serde_json::to_string_pretty(&boards)?;
        vault.write_config(KANBAN_FILE, &json)?;
        Ok(boards)
    }
}

/// Trim a user-supplied name, falling back to `default` when it's blank.
fn clean_name(name: &str, default: &str) -> String {
    let t = name.trim();
    if t.is_empty() {
        default.to_string()
    } else {
        t.to_string()
    }
}

/// Normalize an optional tag: trim and treat blank as "no tag".
fn clean_tag(tag: Option<String>) -> Option<String> {
    tag.map(|t| t.trim().to_string()).filter(|t| !t.is_empty())
}


#[cfg(test)]
mod tests;
