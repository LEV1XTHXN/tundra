use super::*;
use uuid::Uuid;

// Tiny Hunspell dictionaries built inline so the engine is fully testable
// without vendoring a real (licensed) language dictionary.
const EN_AFF: &str = "SET UTF-8\n";
const EN_DIC: &str = "3\nhello\nworld\ncat\n";
const FR_AFF: &str = "SET UTF-8\n";
const FR_DIC: &str = "2\nbonjour\nchat\n";

fn temp_vault() -> (Vault, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("tundra-spell-{}", Uuid::new_v4()));
    (Vault::open(&dir).unwrap(), dir)
}

fn en() -> Vec<(String, String)> {
    vec![(EN_AFF.to_string(), EN_DIC.to_string())]
}

#[test]
fn flags_misspellings_and_leaves_known_words_alone() {
    let (vault, dir) = temp_vault();
    let sc = SpellChecker::open(&vault, &en()).unwrap();

    let hits = sc.check("hello wrld");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].word, "wrld");
    // Offset/length line up with the input (UTF-16 units == byte units here).
    assert_eq!(hits[0].offset, 6);
    assert_eq!(hits[0].length, 4);
    // A plausible suggestion (edit distance 1 from "world").
    assert!(hits[0].suggestions.iter().any(|s| s == "world"), "suggests 'world': {:?}", hits[0].suggestions);

    assert!(sc.check("hello world cat").is_empty());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn personal_dictionary_accepts_and_persists_per_vault() {
    let (vault, dir) = temp_vault();
    let sc = SpellChecker::open(&vault, &en()).unwrap();

    assert_eq!(sc.check("Tundra").len(), 1, "unknown word flagged first");
    sc.add_word("Tundra").unwrap();
    assert!(sc.check("Tundra").is_empty(), "added word no longer flagged");
    assert!(sc.check("tundra").is_empty(), "case-insensitive accept");
    assert!(sc.personal_words().contains(&"Tundra".to_string()));

    // Persisted to .vault/dictionaries/personal.dic and survives a reopen.
    assert!(dir.join(".vault/dictionaries/personal.dic").exists());
    let reopened = SpellChecker::open(&vault, &en()).unwrap();
    assert!(reopened.check("Tundra").is_empty(), "personal word survives reload");

    // Removing it re-flags the word.
    reopened.remove_word("Tundra").unwrap();
    assert_eq!(reopened.check("Tundra").len(), 1);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn enabling_a_second_language_accepts_its_words() {
    let (vault, dir) = temp_vault();
    let sc = SpellChecker::open(&vault, &en()).unwrap();
    assert_eq!(sc.check("bonjour").len(), 1, "French word flagged with only English");

    sc.set_languages(&[
        (EN_AFF.to_string(), EN_DIC.to_string()),
        (FR_AFF.to_string(), FR_DIC.to_string()),
    ])
    .unwrap();
    assert!(sc.check("bonjour").is_empty(), "French word accepted after enabling French");
    assert!(sc.check("hello").is_empty(), "English still accepted");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn no_language_dictionary_flags_nothing() {
    // The deferred-dictionary case: spellcheck must be inert, not flag all.
    let (vault, dir) = temp_vault();
    let sc = SpellChecker::open(&vault, &[]).unwrap();
    assert!(sc.check("qwertyuiop zzz").is_empty());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn utf16_offsets_account_for_non_ascii() {
    let (vault, dir) = temp_vault();
    let sc = SpellChecker::open(&vault, &en()).unwrap();
    // "café " is 5 UTF-16 units before the misspelled "wrld"; "café" is not in
    // the dict, so it's also flagged — assert the second hit's offset is UTF-16.
    let hits = sc.check("café wrld");
    let wrld = hits.iter().find(|m| m.word == "wrld").unwrap();
    assert_eq!(wrld.offset, 5, "offset counts 'café ' as 5 UTF-16 units");
    std::fs::remove_dir_all(&dir).ok();
}
