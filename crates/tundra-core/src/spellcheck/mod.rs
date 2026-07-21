//! Multilingual spellcheck (Phase 3 step 4) — the engine.
//!
//! Uses `zspell` (pure-Rust, Hunspell-compatible) with standard `.aff`/`.dic`
//! dictionaries. A token is misspelled only if **no** enabled language dictionary
//! accepts it **and** it isn't in the per-vault personal dictionary
//! (`.vault/dictionaries/personal.dic`). Adding a word takes effect immediately.
//!
//! The core is platform-agnostic: it takes dictionary *contents* (aff+dic
//! strings), never resource paths. The Tauri layer resolves bundled language
//! resources and hands their contents in, mirroring how the vault path is passed.
//! With **no** language dictionary loaded (e.g. before a real dictionary is
//! bundled), `check` returns nothing rather than flagging every word — spellcheck
//! is simply inert until a dictionary is available.

use std::collections::HashSet;
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use specta::Type;
use zspell::{DictBuilder, Dictionary};

use crate::error::{CoreError, Result};
use crate::vault::Vault;

/// Per-vault personal dictionary file, one word per line.
const PERSONAL_FILE: &str = "personal.dic";
/// Cap on suggestions returned per misspelling.
const MAX_SUGGESTIONS: usize = 7;

/// A misspelled span within checked text. `offset`/`length` are in **UTF-16 code
/// units**, so they line up directly with JavaScript string indexing — the editor
/// (step 5) decorates ProseMirror text nodes, which address text in JS string
/// units, not Rust bytes or Unicode scalars.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct Misspelling {
    pub offset: u32,
    pub length: u32,
    pub word: String,
    pub suggestions: Vec<String>,
}

struct Inner {
    /// Enabled language dictionaries; a word correct in ANY of them is accepted.
    dicts: Vec<Dictionary>,
    /// Personal words as written (for listing + file), plus a lowercased set for
    /// O(1) case-insensitive acceptance.
    personal: Vec<String>,
    personal_lower: HashSet<String>,
}

/// The spellchecker for one open vault — opened and held alongside the search/
/// link indexes (see the Tauri `AppState`), shared via `Arc`. The personal
/// dictionary is mutable at runtime (add/remove word); language dictionaries can
/// be swapped when the user enables/disables languages.
pub struct SpellChecker {
    personal_path: PathBuf,
    inner: RwLock<Inner>,
}

impl SpellChecker {
    /// Open the vault's personal dictionary and build the enabled language
    /// dictionaries from `(aff, dic)` content pairs.
    pub fn open(vault: &Vault, lang_dicts: &[(String, String)]) -> Result<Arc<Self>> {
        let personal_path = vault
            .root()
            .join(".vault/dictionaries")
            .join(PERSONAL_FILE);
        let (personal, personal_lower) = load_personal(&personal_path)?;
        let dicts = build_dicts(lang_dicts)?;
        Ok(Arc::new(SpellChecker {
            personal_path,
            inner: RwLock::new(Inner {
                dicts,
                personal,
                personal_lower,
            }),
        }))
    }

    /// Replace the enabled language dictionaries (enable/disable a language at
    /// runtime). Contents are provided by the caller.
    pub fn set_languages(&self, lang_dicts: &[(String, String)]) -> Result<()> {
        let dicts = build_dicts(lang_dicts)?;
        self.inner.write().unwrap().dicts = dicts;
        Ok(())
    }

    /// The misspelled spans in `text`. Empty when no language dictionary is
    /// loaded, so nothing is flagged spuriously.
    pub fn check(&self, text: &str) -> Vec<Misspelling> {
        let inner = self.inner.read().unwrap();
        if inner.dicts.is_empty() {
            return Vec::new();
        }
        let mut out = Vec::new();
        // Running UTF-16 offset, advanced as we scan, so mapping to JS string
        // positions is O(n) overall rather than O(n²).
        for (byte_off, word) in tokenize(text) {
            if is_correct(&inner, word) {
                continue;
            }
            let offset = utf16_len(&text[..byte_off]);
            out.push(Misspelling {
                offset,
                length: utf16_len(word),
                word: word.to_string(),
                suggestions: suggestions_for(&inner, word),
            });
        }
        out
    }

    /// Add a word to the per-vault personal dictionary, effective immediately.
    /// A word already present (case-insensitively) is a no-op.
    pub fn add_word(&self, word: &str) -> Result<()> {
        let w = word.trim();
        if w.is_empty() {
            return Ok(());
        }
        let words = {
            let mut inner = self.inner.write().unwrap();
            if !inner.personal_lower.insert(w.to_lowercase()) {
                return Ok(());
            }
            inner.personal.push(w.to_string());
            inner.personal.clone()
        };
        write_personal(&self.personal_path, &words)
    }

    /// Remove a word from the personal dictionary (case-insensitive match).
    pub fn remove_word(&self, word: &str) -> Result<()> {
        let lower = word.trim().to_lowercase();
        let words = {
            let mut inner = self.inner.write().unwrap();
            if !inner.personal_lower.remove(&lower) {
                return Ok(());
            }
            inner.personal.retain(|w| w.to_lowercase() != lower);
            inner.personal.clone()
        };
        write_personal(&self.personal_path, &words)
    }

    /// The personal dictionary's words (as written), sorted for stable display.
    pub fn personal_words(&self) -> Vec<String> {
        let mut v = self.inner.read().unwrap().personal.clone();
        v.sort_unstable();
        v
    }
}

fn is_correct(inner: &Inner, word: &str) -> bool {
    if inner.personal_lower.contains(&word.to_lowercase()) {
        return true;
    }
    inner.dicts.iter().any(|d| d.check_word(word))
}

/// Gather up to [`MAX_SUGGESTIONS`] suggestions across dictionaries, deduped and
/// order-preserving (best/nearest first per dictionary).
fn suggestions_for(inner: &Inner, word: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for dict in &inner.dicts {
        if let Some(list) = dict.entry(word).suggest() {
            for s in list {
                if seen.insert(s.to_string()) {
                    out.push(s.to_string());
                    if out.len() >= MAX_SUGGESTIONS {
                        return out;
                    }
                }
            }
        }
    }
    out
}

fn build_dicts(lang_dicts: &[(String, String)]) -> Result<Vec<Dictionary>> {
    lang_dicts
        .iter()
        .map(|(aff, dic)| {
            DictBuilder::new()
                .config_str(aff)
                .dict_str(dic)
                .build()
                .map_err(|e| CoreError::Vault(format!("failed to load dictionary: {e}")))
        })
        .collect()
}

/// Split text into `(byte_offset, word)` pairs. A word is a maximal run of
/// alphabetic characters plus word-internal apostrophes (so contractions like
/// `don't` stay whole); leading/trailing apostrophes are trimmed.
fn tokenize(text: &str) -> Vec<(usize, &str)> {
    let mut out = Vec::new();
    let bytes = text.as_bytes();
    let mut start: Option<usize> = None;
    for (i, ch) in text.char_indices() {
        let is_word = ch.is_alphabetic() || ch == '\'' || ch == '\u{2019}';
        match (is_word, start) {
            (true, None) => start = Some(i),
            (false, Some(s)) => {
                push_word(&mut out, text, bytes, s, i);
                start = None;
            }
            _ => {}
        }
    }
    if let Some(s) = start {
        push_word(&mut out, text, bytes, s, text.len());
    }
    out
}

fn push_word<'a>(out: &mut Vec<(usize, &'a str)>, text: &'a str, bytes: &[u8], start: usize, end: usize) {
    // Trim apostrophes at the edges (ASCII `'` is one byte; `\u{2019}` is three).
    let mut s = start;
    let mut e = end;
    while s < e && (bytes[s] == b'\'' || text[s..].starts_with('\u{2019}')) {
        s += if bytes[s] == b'\'' { 1 } else { '\u{2019}'.len_utf8() };
    }
    while e > s && (bytes[e - 1] == b'\'' || text[..e].ends_with('\u{2019}')) {
        e -= if bytes[e - 1] == b'\'' { 1 } else { '\u{2019}'.len_utf8() };
    }
    if s < e {
        out.push((s, &text[s..e]));
    }
}

fn utf16_len(s: &str) -> u32 {
    s.encode_utf16().count() as u32
}

/// Read the personal dictionary into `(as-written words, lowercased set)`.
/// Missing file → empty. Blank lines ignored; case-insensitive de-dupe.
fn load_personal(path: &Path) -> Result<(Vec<String>, HashSet<String>)> {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok((Vec::new(), HashSet::new())),
        Err(e) => return Err(e.into()),
    };
    let mut words = Vec::new();
    let mut lower = HashSet::new();
    for line in raw.lines() {
        let w = line.trim();
        if w.is_empty() {
            continue;
        }
        if lower.insert(w.to_lowercase()) {
            words.push(w.to_string());
        }
    }
    Ok((words, lower))
}

/// Rewrite the personal dictionary atomically (temp file + rename), same
/// durability discipline as note/config writes — small file, but a torn write
/// must never corrupt the user's custom words.
fn write_personal(path: &Path, words: &[String]) -> Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| CoreError::Vault("personal dictionary path has no parent".into()))?;
    fs::create_dir_all(dir)?;
    let mut body = words.join("\n");
    if !body.is_empty() {
        body.push('\n');
    }
    let mut tmp = tempfile::Builder::new().prefix(".dic-tmp-").tempfile_in(dir)?;
    tmp.write_all(body.as_bytes())?;
    tmp.as_file().sync_all()?;
    tmp.persist(path).map_err(|e| CoreError::Io(e.to_string()))?;
    Ok(())
}


#[cfg(test)]
mod tests;
