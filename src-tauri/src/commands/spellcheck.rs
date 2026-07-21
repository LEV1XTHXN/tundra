use super::*;

use super::config::app_settings_path;

// --- spellcheck (Phase 3 step 4) ----------------------------------------

/// The available (bundled) vs. currently-enabled spellcheck languages.
#[derive(Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SpellLanguages {
    /// Language codes with a bundled `<lang>.aff`+`<lang>.dic` resource.
    pub available: Vec<String>,
    /// Language codes currently enabled (app-setting; defaults to all available).
    pub enabled: Vec<String>,
}

/// Persisted spellcheck preferences (global app-setting, cross-vault).
#[derive(Debug, Default, Serialize, Deserialize)]
struct SpellcheckConfig {
    languages: Vec<String>,
}

const SPELLCHECK_SETTINGS: &str = "spellcheck";

/// The bundled dictionaries directory inside the app's resources, if resolvable.
fn dict_resource_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().resource_dir().ok().map(|d| d.join("dictionaries"))
}

/// Language codes with BOTH a `<lang>.aff` and `<lang>.dic` in resources.
fn available_languages(app: &AppHandle) -> Vec<String> {
    let Some(dir) = dict_resource_dir(app) else {
        return Vec::new();
    };
    let mut langs = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("dic") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    if dir.join(format!("{stem}.aff")).exists() {
                        langs.push(stem.to_string());
                    }
                }
            }
        }
    }
    langs.sort();
    langs
}

/// Read the `(aff, dic)` contents for each requested language that resolves.
pub(super) fn read_lang_dicts(app: &AppHandle, langs: &[String]) -> Vec<(String, String)> {
    let Some(dir) = dict_resource_dir(app) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for lang in langs {
        let aff = std::fs::read_to_string(dir.join(format!("{lang}.aff")));
        let dic = std::fs::read_to_string(dir.join(format!("{lang}.dic")));
        if let (Ok(a), Ok(d)) = (aff, dic) {
            out.push((a, d));
        }
    }
    out
}

/// Enabled languages from the app-setting, or — when unset — all available ones
/// (so a freshly-bundled dictionary is on by default).
pub(super) fn enabled_languages(app: &AppHandle) -> Vec<String> {
    match app_settings_path(app, SPELLCHECK_SETTINGS)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<SpellcheckConfig>(&s).ok())
    {
        Some(cfg) => cfg.languages,
        None => available_languages(app),
    }
}

/// Misspelled spans in `text` (offsets/lengths in UTF-16 units). Empty when no
/// language dictionary is loaded.
#[tauri::command]
#[specta::specta]
pub fn spellcheck_check(state: State<AppState>, text: String) -> Result<Vec<Misspelling>, CoreError> {
    Ok(current_spellcheck(&state)?.check(&text))
}

/// Add a word to the per-vault personal dictionary (effective immediately).
#[tauri::command]
#[specta::specta]
pub fn spellcheck_add_word(state: State<AppState>, word: String) -> Result<(), CoreError> {
    current_spellcheck(&state)?.add_word(&word)
}

/// Remove a word from the personal dictionary (Settings; step 6).
#[tauri::command]
#[specta::specta]
pub fn spellcheck_remove_word(state: State<AppState>, word: String) -> Result<(), CoreError> {
    current_spellcheck(&state)?.remove_word(&word)
}

/// The personal dictionary's words (for the Settings dictionary manager).
#[tauri::command]
#[specta::specta]
pub fn spellcheck_personal_words(state: State<AppState>) -> Result<Vec<String>, CoreError> {
    Ok(current_spellcheck(&state)?.personal_words())
}

/// Available (bundled) and enabled spellcheck languages.
#[tauri::command]
#[specta::specta]
pub fn spellcheck_languages(app: AppHandle) -> Result<SpellLanguages, CoreError> {
    Ok(SpellLanguages {
        available: available_languages(&app),
        enabled: enabled_languages(&app),
    })
}

/// Enable exactly `languages` (persisted globally) and apply to the open vault's
/// spellchecker immediately.
#[tauri::command]
#[specta::specta]
pub fn spellcheck_set_languages(
    app: AppHandle,
    state: State<AppState>,
    languages: Vec<String>,
) -> Result<(), CoreError> {
    let path = app_settings_path(&app, SPELLCHECK_SETTINGS)?;
    let json = serde_json::to_string_pretty(&SpellcheckConfig {
        languages: languages.clone(),
    })?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json.as_bytes())?;
    std::fs::rename(&tmp, &path)?;

    if let Ok(sc) = current_spellcheck(&state) {
        sc.set_languages(&read_lang_dicts(&app, &languages))?;
    }
    Ok(())
}
