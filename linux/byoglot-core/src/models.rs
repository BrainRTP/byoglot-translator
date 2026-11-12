use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderPreset {
    Deepseek,
    Openrouter,
    Ollama,
    Lmstudio,
    Custom,
}

impl ProviderPreset {
    pub fn wire(self) -> &'static str {
        match self {
            Self::Deepseek => "deepseek",
            Self::Openrouter => "openrouter",
            Self::Ollama => "ollama",
            Self::Lmstudio => "lmstudio",
            Self::Custom => "custom",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DisplayMode {
    Replace,
    Bilingual,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelRef {
    #[serde(rename = "providerID")]
    pub provider_id: String,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelInfo {
    #[serde(rename = "providerID")]
    pub provider_id: String,
    pub id: String,
    pub name: String,
    pub variants: Vec<String>,
    pub context_limit: u32,
    pub output_limit: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Connection {
    pub id: String,
    pub preset: ProviderPreset,
    pub name: String,
    pub base_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_model: Option<ModelRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection_model: Option<ModelRef>,
}

#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TemplateSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pre_prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_lang: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_mode: Option<DisplayMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_only: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_model: Option<ModelRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection_model: Option<ModelRef>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Template {
    pub id: String,
    pub name: String,
    pub builtin: bool,
    pub settings: TemplateSettings,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfileOverride {
    pub text: String,
    pub base: String,
    pub saved_at: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortableGlobals {
    pub source_lang: String,
    pub target_lang: String,
    pub language_prompt_enabled: bool,
    pub language_profile: String,
    pub default_template_id: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SiteRule {
    pub id: String,
    pub pattern: String,
    pub template_id: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportConnection {
    pub id: String,
    pub preset: ProviderPreset,
    pub name: String,
    pub base_url: String,
}
