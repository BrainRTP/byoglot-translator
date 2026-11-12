use crate::{
    Connection, HttpTransport, ModelInfo, ProviderClient, ProviderPreset, RunnerError, SecretStore,
    SettingsRepository, is_local_host, needs_key, origin_of, pick_initial_models,
    runner::{invalid_base_url, secret_failure},
};
use serde::{Deserialize, Serialize};
use std::{
    fmt,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionDraft {
    pub id: Option<String>,
    pub preset: ProviderPreset,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
}
impl fmt::Debug for ConnectionDraft {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ConnectionDraft")
            .field("id", &self.id)
            .field("preset", &self.preset)
            .field("name", &self.name)
            .field("base_url", &self.base_url)
            .field("api_key", &"[redacted]")
            .finish()
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub enum DraftProblem {
    BaseUrl,
    ApiKey,
    InsecureRemote,
}
pub struct ConnectionEditor<S, K, T> {
    settings: S,
    secrets: K,
    transport: Arc<T>,
}
impl<S: SettingsRepository, K: SecretStore, T: HttpTransport + Send> ConnectionEditor<S, K, T> {
    pub fn new(settings: S, secrets: K, transport: T) -> Self {
        Self {
            settings,
            secrets,
            transport: Arc::new(transport),
        }
    }
    pub fn validate(&self, draft: &ConnectionDraft, has_stored_key: bool) -> Option<DraftProblem> {
        let Some(url) = crate::effort::endpoint(draft.base_url.trim()) else {
            return Some(DraftProblem::BaseUrl);
        };
        if !url.secure && !is_local_host(&url.host) {
            return Some(DraftProblem::InsecureRemote);
        }
        if needs_key(draft.preset, draft.base_url.trim())
            && draft.api_key.trim().is_empty()
            && !has_stored_key
        {
            return Some(DraftProblem::ApiKey);
        }
        None
    }
    pub async fn save(
        &self,
        draft: ConnectionDraft,
        consent: bool,
    ) -> Result<Connection, RunnerError> {
        let settings = self.settings.read().await;
        let origin = origin_of(draft.base_url.trim()).ok_or_else(invalid_base_url)?;
        let previous = draft
            .id
            .as_ref()
            .and_then(|id| settings.connections.iter().find(|c| &c.id == id));
        let origin_changed =
            previous.is_some_and(|c| origin_of(&c.base_url).as_ref() != Some(&origin));
        let stored = if origin_changed || !draft.api_key.trim().is_empty() {
            None
        } else if let Some(connection) = previous {
            self.secrets
                .get(&connection.id, &origin)
                .await
                .map_err(secret_failure)?
        } else {
            None
        };
        match self.validate(&draft, stored.as_deref().is_some_and(|s| !s.is_empty())) {
            Some(DraftProblem::ApiKey) => return Err(RunnerError::KeyMissing),
            Some(_) => return Err(invalid_base_url()),
            None => (),
        }
        if !crate::effort::local_origin(&origin)
            && !consent
            && !settings.consented_origins.contains(&origin)
        {
            return Err(RunnerError::ConsentNeeded { origin });
        }
        let id = draft.id.unwrap_or_else(next_id);
        let mut connection = Connection {
            id,
            preset: draft.preset,
            name: draft.name.trim().into(),
            base_url: draft.base_url.trim().trim_end_matches('/').into(),
            page_model: previous.and_then(|c| c.page_model.clone()),
            selection_model: previous.and_then(|c| c.selection_model.clone()),
        };
        let typed = draft.api_key.trim();
        let secret = if typed.is_empty() {
            stored
        } else {
            Some(typed.into())
        };
        let client = ProviderClient::new(
            connection.clone(),
            secret.clone(),
            self.transport.clone(),
            SystemTime::now,
        );
        let models = client.list_models().await?;
        let default = if connection.preset == ProviderPreset::Deepseek {
            models.iter().find(|m| m.id == "deepseek-flash")
        } else {
            models.first()
        };
        if previous.is_none() || origin_changed {
            (connection.page_model, connection.selection_model) =
                pick_initial_models(&models, default, &connection.id);
        }
        let saved = connection.clone();
        let consent_origin = origin.clone();
        self.settings
            .update(Box::new(move |mut settings| {
                if let Some(existing) = settings.connections.iter_mut().find(|c| c.id == saved.id) {
                    *existing = saved.clone();
                } else {
                    settings.connections.push(saved.clone());
                }
                if settings.active_connection_id.is_none() {
                    settings.active_connection_id = Some(saved.id);
                }
                if consent && !settings.consented_origins.contains(&consent_origin) {
                    settings.consented_origins.push(consent_origin);
                }
                settings
            }))
            .await;
        if let Some(secret) = secret {
            self.secrets
                .set(&secret, &connection.id, &origin)
                .await
                .map_err(secret_failure)?;
        } else if origin_changed {
            self.secrets
                .delete(&connection.id)
                .await
                .map_err(secret_failure)?;
        }
        Ok(connection)
    }
    pub async fn remove(&self, connection_id: &str) -> Result<(), RunnerError> {
        let id = connection_id.to_owned();
        self.settings
            .update(Box::new(move |mut settings| {
                settings.connections.retain(|c| c.id != id);
                if settings.active_connection_id.as_ref() == Some(&id) {
                    settings.active_connection_id =
                        settings.connections.first().map(|c| c.id.clone());
                }
                for template in &mut settings.templates {
                    for model in [
                        &mut template.settings.page_model,
                        &mut template.settings.selection_model,
                    ] {
                        if model
                            .as_ref()
                            .is_some_and(|m| m.connection_id.as_ref() == Some(&id))
                        {
                            *model = None;
                        }
                    }
                }
                settings
            }))
            .await;
        self.secrets
            .delete(connection_id)
            .await
            .map_err(secret_failure)?;
        Ok(())
    }
    pub async fn models(&self, connection_id: &str) -> Result<Vec<ModelInfo>, RunnerError> {
        let settings = self.settings.read().await;
        let connection = settings
            .connections
            .iter()
            .find(|c| c.id == connection_id)
            .ok_or(RunnerError::NoConnection)?;
        let origin = crate::effort::permitted_endpoint(&connection.base_url)
            .ok_or_else(invalid_base_url)?
            .origin;
        if !crate::effort::local_origin(&origin) && !settings.consented_origins.contains(&origin) {
            return Err(RunnerError::ConsentNeeded { origin });
        }
        let secret = self
            .secrets
            .get(connection_id, &origin)
            .await
            .map_err(secret_failure)?;
        if needs_key(connection.preset, &connection.base_url)
            && secret.as_deref().is_none_or(str::is_empty)
        {
            return Err(RunnerError::KeyMissing);
        }
        ProviderClient::new(
            connection.clone(),
            secret,
            self.transport.clone(),
            SystemTime::now,
        )
        .list_models()
        .await
        .map_err(Into::into)
    }
    pub async fn key_state(&self, connection_id: &str) -> Result<bool, RunnerError> {
        self.secrets
            .has(connection_id)
            .await
            .map_err(secret_failure)
    }
}
fn next_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!(
        "connection-{time:x}-{:x}",
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}
