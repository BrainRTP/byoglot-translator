use crate::{
    BackendError, ErrorKind, HttpTransport, ModelRef, ProviderClient, SecretError, SecretStore,
    SettingsRepository, TextRequest, Translator, contracts, effective, language_prompt_text,
    needs_key,
};
use serde::{Deserialize, Serialize};
use std::{
    hash::{Hash, Hasher},
    sync::Arc,
    time::SystemTime,
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, thiserror::Error)]
pub enum RunnerError {
    #[error("no connection")]
    NoConnection,
    #[error("no model")]
    NoModel,
    #[error("API key missing")]
    KeyMissing,
    #[error("consent needed for {origin}")]
    ConsentNeeded { origin: String },
    #[error("input exceeds {limit} UTF-16 units")]
    TooLong { limit: usize },
    #[error("empty input")]
    Empty,
    #[error("settings or key storage unavailable")]
    Storage,
    #[error(transparent)]
    Backend(#[from] BackendError),
}
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerInput {
    pub text: String,
    pub context: String,
    pub app_name: String,
    pub template_id: Option<String>,
    pub target_lang: Option<String>,
    pub limit: usize,
}
impl std::fmt::Debug for RunnerInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RunnerInput")
            .field("text", &"[redacted]")
            .field("context", &"[redacted]")
            .field("limit", &self.limit)
            .finish_non_exhaustive()
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerOutput {
    pub text: String,
    pub source_lang: String,
    pub target_lang: String,
    pub model: ModelRef,
}
pub struct TranslationRunner<S, K, T> {
    settings: S,
    secrets: K,
    transport: Arc<T>,
    translator: Translator<()>,
}
impl<S: SettingsRepository, K: SecretStore, T: HttpTransport + Send> TranslationRunner<S, K, T> {
    pub fn new(settings: S, secrets: K, transport: T) -> Self {
        Self {
            settings,
            secrets,
            transport: Arc::new(transport),
            translator: Translator::new((), 128),
        }
    }
    pub async fn translate(&self, input: RunnerInput) -> Result<RunnerOutput, RunnerError> {
        let text = input.text.trim();
        if text.is_empty() {
            return Err(RunnerError::Empty);
        }
        if text.encode_utf16().count() > input.limit {
            return Err(RunnerError::TooLong { limit: input.limit });
        }
        let settings = self.settings.read().await;
        let connection = settings
            .connections
            .iter()
            .find(|c| Some(&c.id) == settings.active_connection_id.as_ref())
            .ok_or(RunnerError::NoConnection)?;
        let template = input
            .template_id
            .as_ref()
            .and_then(|id| settings.templates.iter().find(|t| &t.id == id))
            .or_else(|| {
                settings
                    .templates
                    .iter()
                    .find(|t| t.id == settings.globals.default_template_id)
            })
            .unwrap_or(contracts::builtin_template());
        let resolved = effective(template, &settings);
        let target_lang = input.target_lang.unwrap_or(resolved.target_lang);
        let model = resolved.model.ok_or(RunnerError::NoModel)?;
        let origin = crate::effort::permitted_endpoint(&connection.base_url)
            .ok_or_else(invalid_base_url)?
            .origin;
        if !crate::effort::local_origin(&origin) && !settings.consented_origins.contains(&origin) {
            return Err(RunnerError::ConsentNeeded { origin });
        }
        let secret = self
            .secrets
            .get(&connection.id, &origin)
            .await
            .map_err(secret_failure)?;
        if needs_key(connection.preset, &connection.base_url)
            && secret.as_deref().is_none_or(str::is_empty)
        {
            return Err(RunnerError::KeyMissing);
        }
        let language_prompt = language_prompt_text(
            settings.globals.language_prompt_enabled,
            &settings.globals.language_profile,
            &target_lang,
            contracts::builtin_profiles(),
            &settings.profile_overrides,
        );
        let mut namespace = std::collections::hash_map::DefaultHasher::new();
        connection.base_url.hash(&mut namespace);
        secret.hash(&mut namespace);
        let generator = ProviderClient::new(
            connection.clone(),
            secret,
            self.transport.clone(),
            SystemTime::now,
        );
        let output = self
            .translator
            .translate_with(
                TextRequest {
                    text: text.into(),
                    context: input.context,
                    app_name: input.app_name,
                    source_lang: settings.globals.source_lang.clone(),
                    target_lang: target_lang.clone(),
                    pre_prompt: resolved.pre_prompt,
                    language_prompt,
                    model: model.clone(),
                },
                &generator,
                namespace.finish(),
            )
            .await?;
        Ok(RunnerOutput {
            text: output,
            source_lang: settings.globals.source_lang,
            target_lang,
            model,
        })
    }
}
pub(crate) fn secret_failure(error: SecretError) -> RunnerError {
    match error {
        SecretError::OriginMismatch => RunnerError::KeyMissing,
        SecretError::Unavailable(_) => RunnerError::Storage,
    }
}
pub(crate) fn invalid_base_url() -> RunnerError {
    let mut error = BackendError::new(ErrorKind::Incompatible);
    error.detail = Some("invalid base URL".into());
    error.into()
}

#[cfg(test)]
mod privacy_tests {
    use super::*;
    #[test]
    fn input_debug_redacts_user_content() {
        let input = RunnerInput {
            text: "private-text".into(),
            context: "private-context".into(),
            app_name: "private-app".into(),
            template_id: Some("private-id".into()),
            target_lang: Some("private-target".into()),
            limit: 20000,
        };
        assert!(!format!("{input:?}").contains("private-"));
        assert_eq!(
            secret_failure(SecretError::Unavailable("private-error".into())),
            RunnerError::Storage
        );
    }
}
