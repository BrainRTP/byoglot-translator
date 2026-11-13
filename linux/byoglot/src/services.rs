use crate::{
    net::ReqwestTransport, secrets::FallbackSecretStore, settings_file::FileSettingsRepository,
};
use byoglot_core::{
    AppSettings, BackendError, Connection, ConnectionDraft, ConnectionEditor, ErrorKind,
    MemorySecretStore, MemorySettingsRepository, RunnerError, SecretStore, SettingsRepository,
    TranslationRunner, origin_of,
};
use std::{path::PathBuf, sync::Arc};
use tokio::{runtime::Handle, sync::Mutex};

type Settings = Arc<FileSettingsRepository>;
type Secrets = Arc<FallbackSecretStore>;
pub type Runner = TranslationRunner<Settings, Secrets, ReqwestTransport>;
pub type Editor = ConnectionEditor<Settings, Secrets, ReqwestTransport>;

pub struct Services {
    pub settings: Settings,
    pub secrets: Secrets,
    pub transport: ReqwestTransport,
    pub runner: Runner,
    pub editor: Editor,
    pub runtime: Handle,
    mutation: Mutex<()>,
    #[cfg(feature = "gui")]
    startup_path: PathBuf,
}

fn failed() -> RunnerError {
    BackendError::new(ErrorKind::Offline).into()
}

impl Services {
    pub async fn new(
        path: PathBuf,
        language: Option<String>,
        runtime: Handle,
    ) -> Result<Arc<Self>, RunnerError> {
        #[cfg(feature = "gui")]
        let startup_path = path.with_file_name("startup.json");
        let settings = Arc::new(FileSettingsRepository::new(path, language));
        let secrets = Arc::new(FallbackSecretStore::open().await);
        let transport = ReqwestTransport::new(runtime.clone()).map_err(|_| failed())?;
        Ok(Arc::new(Self {
            runner: TranslationRunner::new(settings.clone(), secrets.clone(), transport.clone()),
            editor: ConnectionEditor::new(settings.clone(), secrets.clone(), transport.clone()),
            settings,
            secrets,
            transport,
            runtime,
            mutation: Mutex::new(()),
            #[cfg(feature = "gui")]
            startup_path,
        }))
    }

    pub async fn translate(
        self: &Arc<Self>,
        input: byoglot_core::RunnerInput,
    ) -> Result<byoglot_core::RunnerOutput, RunnerError> {
        let services = self.clone();
        let mut task = crate::net::AbortOnDrop(
            self.runtime
                .spawn(async move { services.runner.translate(input).await }),
        );
        (&mut task.0).await.map_err(|_| failed())?
    }

    pub async fn models(
        self: &Arc<Self>,
        id: String,
    ) -> Result<Vec<byoglot_core::ModelInfo>, RunnerError> {
        let services = self.clone();
        let mut task = crate::net::AbortOnDrop(
            self.runtime
                .spawn(async move { services.editor.models(&id).await }),
        );
        (&mut task.0).await.map_err(|_| failed())?
    }

    pub async fn key_state(self: &Arc<Self>, id: String) -> Result<bool, RunnerError> {
        let services = self.clone();
        self.runtime
            .spawn(async move { services.editor.key_state(&id).await })
            .await
            .map_err(|_| failed())?
    }

    #[cfg(feature = "gui")]
    pub fn startup_enabled(&self) -> bool {
        std::fs::read(&self.startup_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or(false)
    }

    #[cfg(feature = "gui")]
    pub async fn set_startup(
        self: &Arc<Self>,
        enabled: bool,
        reason: &'static str,
    ) -> Result<bool, RunnerError> {
        let services = self.clone();
        self.runtime
            .spawn(async move {
                let _guard = services.mutation.lock().await;
                let response = ashpd::desktop::background::Background::request()
                    .reason(reason)
                    .auto_start(enabled)
                    .command(["byoglot", "--background"])
                    .dbus_activatable(false)
                    .send()
                    .await
                    .map_err(|_| failed())?
                    .response()
                    .map_err(|_| failed())?;
                let actual = response.auto_start();
                if let Some(parent) = services.startup_path.parent() {
                    std::fs::create_dir_all(parent).map_err(|_| failed())?;
                }
                let temporary = services.startup_path.with_extension("json.tmp");
                std::fs::write(&temporary, if actual { "true" } else { "false" })
                    .map_err(|_| failed())?;
                std::fs::rename(temporary, &services.startup_path).map_err(|_| failed())?;
                Ok(actual)
            })
            .await
            .map_err(|_| failed())?
    }

    pub async fn save_connection(
        self: &Arc<Self>,
        draft: ConnectionDraft,
        consent: bool,
    ) -> Result<Connection, RunnerError> {
        let services = self.clone();
        // Once submitted, the transaction completes even if its dialog closes.
        self.runtime
            .spawn(async move { services.commit_connection(draft, consent).await })
            .await
            .map_err(|_| failed())?
    }

    async fn commit_connection(
        &self,
        draft: ConnectionDraft,
        consent: bool,
    ) -> Result<Connection, RunnerError> {
        let _guard = self.mutation.lock().await;
        let before = self.settings.read().await;
        let previous = draft
            .id
            .as_ref()
            .and_then(|id| before.connections.iter().find(|c| &c.id == id));
        let old_origin = previous.and_then(|c| origin_of(&c.base_url));
        let old_key = if let (Some(c), Some(origin)) = (previous, &old_origin) {
            self.secrets
                .get(&c.id, origin)
                .await
                .map_err(|_| failed())?
        } else {
            None
        };
        let staged_settings = Arc::new(MemorySettingsRepository::new(before));
        let staged_secrets = Arc::new(MemorySecretStore::new());
        if let (Some(id), Some(origin), Some(key)) = (&draft.id, &old_origin, &old_key) {
            staged_secrets
                .set(key, id, origin)
                .await
                .map_err(|_| failed())?;
        }
        let editor = ConnectionEditor::new(
            staged_settings.clone(),
            staged_secrets.clone(),
            self.transport.clone(),
        );
        let connection = editor.save(draft, consent).await?;
        let origin = origin_of(&connection.base_url).ok_or_else(failed)?;
        let key = staged_secrets
            .get(&connection.id, &origin)
            .await
            .map_err(|_| failed())?;
        if let Some(key) = &key {
            self.secrets
                .set(key, &connection.id, &origin)
                .await
                .map_err(|_| failed())?;
        } else {
            self.secrets
                .delete(&connection.id)
                .await
                .map_err(|_| failed())?;
        }
        let saved = connection.clone();
        let result = self.settings.try_update(move |mut settings| {
            if let Some(existing) = settings.connections.iter_mut().find(|c| c.id == saved.id) {
                *existing = saved.clone();
            } else {
                settings.connections.push(saved.clone());
            }
            if settings.active_connection_id.is_none() {
                settings.active_connection_id = Some(saved.id);
            }
            if consent && !settings.consented_origins.contains(&origin) {
                settings.consented_origins.push(origin);
            }
            settings
        });
        if result.is_err() {
            if let (Some(origin), Some(key)) = (old_origin, old_key) {
                self.secrets
                    .set(&key, &connection.id, &origin)
                    .await
                    .map_err(|_| failed())?;
            } else {
                self.secrets
                    .delete(&connection.id)
                    .await
                    .map_err(|_| failed())?;
            }
            return Err(failed());
        }
        Ok(connection)
    }

    pub async fn change(
        &self,
        change: impl FnOnce(AppSettings) -> AppSettings,
    ) -> Result<AppSettings, RunnerError> {
        let _guard = self.mutation.lock().await;
        self.settings.try_update(change).map_err(|_| failed())
    }

    pub async fn wait_for_writes(&self) {
        let _guard = self.mutation.lock().await;
    }

    pub async fn remove_connection(self: &Arc<Self>, id: String) -> Result<(), RunnerError> {
        let services = self.clone();
        self.runtime
            .spawn(async move {
                let _guard = services.mutation.lock().await;
                let before = services.settings.read().await;
                let previous = before.connections.iter().find(|c| c.id == id);
                let origin = previous.and_then(|c| origin_of(&c.base_url));
                let key = if let Some(origin) = &origin {
                    services
                        .secrets
                        .get(&id, origin)
                        .await
                        .map_err(|_| failed())?
                } else {
                    None
                };
                let staged = Arc::new(MemorySettingsRepository::new(before));
                let editor = ConnectionEditor::new(
                    staged.clone(),
                    MemorySecretStore::new(),
                    services.transport.clone(),
                );
                editor.remove(&id).await?;
                let after = staged.read().await;
                services.secrets.delete(&id).await.map_err(|_| failed())?;
                if services.settings.try_update(|_| after).is_err() {
                    if let (Some(origin), Some(key)) = (origin, key) {
                        services
                            .secrets
                            .set(&key, &id, &origin)
                            .await
                            .map_err(|_| failed())?;
                    }
                    return Err(failed());
                }
                Ok(())
            })
            .await
            .map_err(|_| failed())?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        time::Duration,
    };

    fn services(path: PathBuf) -> Arc<Services> {
        let runtime = Handle::current();
        #[cfg(feature = "gui")]
        let startup_path = path.with_file_name("startup.json");
        let settings = Arc::new(FileSettingsRepository::new(path, None));
        let secrets = Arc::new(FallbackSecretStore::memory());
        let transport = ReqwestTransport::new(runtime.clone()).unwrap();
        Arc::new(Services {
            runner: TranslationRunner::new(settings.clone(), secrets.clone(), transport.clone()),
            editor: ConnectionEditor::new(settings.clone(), secrets.clone(), transport.clone()),
            settings,
            secrets,
            transport,
            runtime,
            mutation: Mutex::new(()),
            #[cfg(feature = "gui")]
            startup_path,
        })
    }

    fn provider() -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let task = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut bytes = [0; 8192];
            assert!(socket.read(&mut bytes).unwrap() > 0);
            std::thread::sleep(Duration::from_millis(40));
            let body = r#"{"data":[{"id":"model"}]}"#;
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });
        (url, task)
    }

    fn draft(url: String) -> ConnectionDraft {
        ConnectionDraft {
            id: Some("c".into()),
            preset: byoglot_core::ProviderPreset::Custom,
            name: "Local".into(),
            base_url: url,
            api_key: "new-key".into(),
        }
    }

    #[tokio::test]
    async fn cancelled_save_finishes_both_writes() {
        let path = std::env::temp_dir().join(format!("byoglot-cancel-{}.json", std::process::id()));
        let services = services(path.clone());
        let (url, server) = provider();
        let origin = origin_of(&url).unwrap();
        let mut future = Box::pin(services.save_connection(draft(url), true));
        tokio::select! { _ = &mut future => panic!("finished too early"), _ = tokio::time::sleep(Duration::from_millis(10)) => () }
        drop(future);
        for _ in 0..100 {
            if !services.settings.read().await.connections.is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(services.settings.read().await.connections.len(), 1);
        assert_eq!(
            services.secrets.get("c", &origin).await.unwrap().as_deref(),
            Some("new-key")
        );
        server.join().unwrap();
        std::fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn settings_write_failure_restores_the_previous_key() {
        let directory =
            std::env::temp_dir().join(format!("byoglot-rollback-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let (url, server) = provider();
        let origin = origin_of(&url).unwrap();
        // A directory cannot be atomically replaced by the settings file.
        let mut before = AppSettings::initial(None);
        before.connections.push(Connection {
            id: "c".into(),
            preset: byoglot_core::ProviderPreset::Custom,
            name: "Old".into(),
            base_url: url.clone(),
            page_model: None,
            selection_model: None,
        });
        let temporary = directory.join("settings.json");
        let working = services(temporary.clone());
        working.settings.try_update(|_| before).unwrap();
        working.secrets.set("old-key", "c", &origin).await.unwrap();
        std::fs::create_dir(temporary.with_extension("json.tmp")).unwrap();
        assert!(working.save_connection(draft(url), true).await.is_err());
        assert_eq!(
            working.secrets.get("c", &origin).await.unwrap().as_deref(),
            Some("old-key")
        );
        server.join().unwrap();
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn failed_deletion_preserves_the_connection_and_key() {
        let directory = std::env::temp_dir().join(format!("byoglot-delete-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("settings.json");
        let service = services(path.clone());
        let mut settings = AppSettings::initial(None);
        settings.connections.push(Connection {
            id: "c".into(),
            preset: byoglot_core::ProviderPreset::Custom,
            name: "Local".into(),
            base_url: "http://localhost/v1".into(),
            page_model: None,
            selection_model: None,
        });
        service.settings.try_update(|_| settings).unwrap();
        service
            .secrets
            .set("old-key", "c", "http://localhost")
            .await
            .unwrap();
        std::fs::create_dir(path.with_extension("json.tmp")).unwrap();
        assert!(service.remove_connection("c".into()).await.is_err());
        assert_eq!(service.settings.read().await.connections.len(), 1);
        assert_eq!(
            service
                .secrets
                .get("c", "http://localhost")
                .await
                .unwrap()
                .as_deref(),
            Some("old-key")
        );
        std::fs::remove_dir_all(directory).unwrap();
    }
}
