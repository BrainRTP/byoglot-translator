use crate::{ProfileOverride, contracts::GENERIC_PROFILE};
use std::collections::{BTreeMap, HashMap};

pub fn primary_lang(code: &str) -> String {
    code.split(['-', '_']).next().unwrap_or("").to_lowercase()
}

pub fn language_prompt_text(
    enabled: bool,
    profile: &str,
    target_lang: &str,
    builtins: &BTreeMap<String, String>,
    overrides: &HashMap<String, ProfileOverride>,
) -> String {
    if !enabled {
        return String::new();
    }
    let primary = primary_lang(target_lang);
    let choice = if profile == GENERIC_PROFILE || profile == primary {
        profile
    } else {
        "auto"
    };
    let id = if builtins.contains_key(choice) {
        choice
    } else if builtins.contains_key(&primary) {
        &primary
    } else {
        GENERIC_PROFILE
    };
    let builtin = builtins.get(id).map(String::as_str).unwrap_or("");
    match overrides.get(id) {
        Some(value) if value.text.trim() != builtin.trim() => value.text.clone(),
        _ => builtin.into(),
    }
}
