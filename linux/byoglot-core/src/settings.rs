use crate::{
    Connection, ModelInfo, ModelRef, PortableGlobals, ProfileOverride, SiteRule, Template,
    contracts, primary_lang,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const QUICK_INPUT_LIMIT: usize = 5000;
pub fn editor_input_limit() -> usize {
    contracts::limits().max_editor_text
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub schema_version: u32,
    pub globals: PortableGlobals,
    pub templates: Vec<Template>,
    #[serde(default)]
    pub profile_overrides: HashMap<String, ProfileOverride>,
    #[serde(default)]
    pub site_rules: Vec<SiteRule>,
    #[serde(default)]
    pub connections: Vec<Connection>,
    #[serde(default)]
    pub active_connection_id: Option<String>,
    #[serde(default)]
    pub consented_origins: Vec<String>,
}
impl AppSettings {
    pub fn initial(preferred_language: Option<&str>) -> Self {
        let language = primary_lang(preferred_language.unwrap_or("en"));
        Self {
            schema_version: 1,
            globals: PortableGlobals {
                source_lang: "auto".into(),
                target_lang: if contracts::language_codes().contains(&language) {
                    language
                } else {
                    "en".into()
                },
                language_prompt_enabled: true,
                language_profile: "auto".into(),
                default_template_id: contracts::builtin_template().id.clone(),
            },
            templates: vec![contracts::builtin_template().clone()],
            profile_overrides: HashMap::new(),
            site_rules: Vec::new(),
            connections: Vec::new(),
            active_connection_id: None,
            consented_origins: Vec::new(),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Effective {
    pub pre_prompt: String,
    pub target_lang: String,
    pub model: Option<ModelRef>,
}
pub fn effective(template: &Template, settings: &AppSettings) -> Effective {
    let connection = settings
        .connections
        .iter()
        .find(|c| Some(&c.id) == settings.active_connection_id.as_ref());
    Effective {
        pre_prompt: template.settings.pre_prompt.clone().unwrap_or_default(),
        target_lang: template
            .settings
            .target_lang
            .clone()
            .unwrap_or_else(|| settings.globals.target_lang.clone()),
        model: template
            .settings
            .selection_model
            .clone()
            .filter(|m| m.connection_id == settings.active_connection_id)
            .or_else(|| connection.and_then(|c| c.selection_model.clone())),
    }
}
pub fn pick_initial_models(
    models: &[ModelInfo],
    default_model: Option<&ModelInfo>,
    connection_id: &str,
) -> (Option<ModelRef>, Option<ModelRef>) {
    let favorite = contracts::favorite_model();
    let picked = models
        .iter()
        .find(|m| m.provider_id == favorite.provider_id && m.id == favorite.id)
        .or(default_model);
    let page = picked.map(|m| ModelRef {
        provider_id: m.provider_id.clone(),
        id: m.id.clone(),
        variant: m
            .variants
            .iter()
            .find(|v| v.as_str() == "none")
            .or_else(|| {
                if m.provider_id == favorite.provider_id && m.id == favorite.id {
                    None
                } else {
                    m.variants.first()
                }
            })
            .cloned(),
        connection_id: Some(connection_id.into()),
    });
    let selection = picked.map(|m| ModelRef {
        provider_id: m.provider_id.clone(),
        id: m.id.clone(),
        variant: m
            .variants
            .iter()
            .find(|v| v.as_str() == contracts::selection_default_effort())
            .cloned()
            .or_else(|| page.as_ref().and_then(|p| p.variant.clone())),
        connection_id: Some(connection_id.into()),
    });
    (page, selection)
}
