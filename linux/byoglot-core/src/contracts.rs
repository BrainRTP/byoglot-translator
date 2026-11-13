use crate::{ModelRef, ProviderPreset, Template};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    sync::LazyLock,
};

pub const GENERIC_PROFILE: &str = "generic";

#[derive(Deserialize)]
struct Languages {
    auto: String,
    codes: Vec<String>,
    names: HashMap<String, String>,
}
static LANGUAGES: LazyLock<Languages> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../contracts/languages.json")).unwrap()
});
pub fn auto_source_name() -> &'static str {
    &LANGUAGES.auto
}
pub fn language_codes() -> &'static [String] {
    &LANGUAGES.codes
}
pub fn language_name(code: &str) -> String {
    if code == "auto" {
        auto_source_name().into()
    } else {
        LANGUAGES
            .names
            .get(code)
            .cloned()
            .unwrap_or_else(|| code.into())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetInfo {
    pub base_url: String,
    pub needs_key: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Presets {
    presets: HashMap<ProviderPreset, PresetInfo>,
    favorite_model: ModelRef,
    selection_default_effort: String,
}
static PRESETS: LazyLock<Presets> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../contracts/presets.json")).unwrap()
});
pub fn presets() -> &'static HashMap<ProviderPreset, PresetInfo> {
    &PRESETS.presets
}
pub fn favorite_model() -> &'static ModelRef {
    &PRESETS.favorite_model
}
pub fn selection_default_effort() -> &'static str {
    &PRESETS.selection_default_effort
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    pub max_blocks: usize,
    pub max_chars: usize,
    pub concurrency: usize,
    pub generate_timeout_ms: u64,
    pub max_profile_text: usize,
    pub max_selection: usize,
    pub max_context: usize,
}
static LIMITS: LazyLock<Limits> =
    LazyLock::new(|| serde_json::from_str(include_str!("../../../contracts/limits.json")).unwrap());
pub fn limits() -> &'static Limits {
    &LIMITS
}
static TEMPLATE: LazyLock<Template> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../contracts/builtin-template.json")).unwrap()
});
pub fn builtin_template() -> &'static Template {
    &TEMPLATE
}
mod bundled {
    include!(concat!(env!("OUT_DIR"), "/profiles.rs"));
}
static PROFILES: LazyLock<BTreeMap<String, String>> = LazyLock::new(|| {
    bundled::PROFILES
        .iter()
        .map(|(id, text)| ((*id).into(), text.trim().into()))
        .collect()
});
pub fn builtin_profiles() -> &'static BTreeMap<String, String> {
    &PROFILES
}
