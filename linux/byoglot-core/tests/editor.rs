mod common;
use byoglot_core::*;
use common::*;
use std::sync::Arc;

fn draft() -> ConnectionDraft {
    ConnectionDraft {
        id: None,
        preset: ProviderPreset::Deepseek,
        name: "DeepSeek".into(),
        base_url: "https://api.deepseek.com///".into(),
        api_key: " key ".into(),
    }
}
type TestEditor =
    ConnectionEditor<Arc<MemorySettingsRepository>, Arc<MemorySecretStore>, RecordingTransport>;
fn editor(
    s: AppSettings,
    transport: RecordingTransport,
) -> (
    TestEditor,
    Arc<MemorySettingsRepository>,
    Arc<MemorySecretStore>,
) {
    let repository = Arc::new(MemorySettingsRepository::new(s));
    let secrets = Arc::new(MemorySecretStore::new());
    (
        ConnectionEditor::new(repository.clone(), secrets.clone(), transport),
        repository,
        secrets,
    )
}
#[tokio::test]
async fn unparsable_url_is_rejected() {
    let (editor, _, _) = editor(AppSettings::initial(None), RecordingTransport::models());
    let mut d = draft();
    d.base_url = "broken url".into();
    assert_eq!(editor.validate(&d, false), Some(DraftProblem::BaseUrl));
    assert!(editor.save(d, true).await.is_err());
}
#[test]
fn public_cleartext_is_rejected_and_lan_is_allowed() {
    let (editor, _, _) = editor(AppSettings::initial(None), RecordingTransport::models());
    let mut d = draft();
    d.base_url = "http://example.com/v1".into();
    assert_eq!(
        editor.validate(&d, false),
        Some(DraftProblem::InsecureRemote)
    );
    for host in [
        "10.0.0.2",
        "172.16.1.1",
        "192.168.1.1",
        "169.254.1.1",
        "[::1]",
        "box.local",
    ] {
        d.base_url = format!("http://{host}/v1");
        assert_eq!(editor.validate(&d, false), None);
    }
}
#[test]
fn required_key_can_be_typed_or_stored() {
    let (editor, _, _) = editor(AppSettings::initial(None), RecordingTransport::models());
    let mut d = draft();
    d.api_key = " ".into();
    assert_eq!(editor.validate(&d, false), Some(DraftProblem::ApiKey));
    assert_eq!(editor.validate(&d, true), None);
    d.preset = ProviderPreset::Custom;
    d.base_url = "http://localhost/v1".into();
    assert_eq!(editor.validate(&d, false), None);
    assert!(!format!("{:?}", draft()).contains(" key "));
}
#[tokio::test]
async fn remote_origin_needs_consent_then_is_recorded() {
    let transport = RecordingTransport::models();
    let (editor, repository, secrets) = editor(AppSettings::initial(None), transport.clone());
    assert_eq!(
        editor.save(draft(), false).await,
        Err(RunnerError::ConsentNeeded {
            origin: "https://api.deepseek.com".into()
        })
    );
    assert!(transport.requests.lock().unwrap().is_empty());
    let saved = editor.save(draft(), true).await.unwrap();
    let s = repository.read().await;
    assert_eq!(s.consented_origins, vec!["https://api.deepseek.com"]);
    assert_eq!(s.active_connection_id.as_ref(), Some(&saved.id));
    assert_eq!(saved.base_url, "https://api.deepseek.com");
    assert_eq!(
        secrets
            .get(&saved.id, "https://api.deepseek.com")
            .await
            .unwrap()
            .as_deref(),
        Some("key")
    );
    assert!(editor.key_state(&saved.id).await.unwrap());
    assert_eq!(editor.models(&saved.id).await.unwrap().len(), 1);
}
#[tokio::test]
async fn changed_origin_never_uses_old_key_and_replaces_it_after_check() {
    let transport = RecordingTransport::models();
    let (editor, repository, secrets) = editor(settings(), transport.clone());
    secrets
        .set("old-key", "c1", "https://api.deepseek.com")
        .await
        .unwrap();
    let mut d = draft();
    d.id = Some("c1".into());
    d.base_url = "https://other.example/v1".into();
    d.api_key.clear();
    assert_eq!(
        editor.save(d.clone(), true).await,
        Err(RunnerError::KeyMissing)
    );
    assert!(transport.requests.lock().unwrap().is_empty());
    d.api_key = "new-key".into();
    editor.save(d, true).await.unwrap();
    assert_eq!(
        transport.requests.lock().unwrap()[0].0.headers["authorization"],
        "Bearer new-key"
    );
    assert_eq!(
        secrets.get("c1", "https://api.deepseek.com").await,
        Err(SecretError::OriginMismatch)
    );
    assert_eq!(
        secrets
            .get("c1", "https://other.example")
            .await
            .unwrap()
            .as_deref(),
        Some("new-key")
    );
    assert_eq!(repository.read().await.connections.len(), 1);
}
#[tokio::test]
async fn failed_model_check_persists_nothing() {
    let transport = RecordingTransport::new(500, serde_json::json!({}));
    let (editor, repository, secrets) = editor(settings(), transport);
    secrets
        .set("old-key", "c1", "https://api.deepseek.com")
        .await
        .unwrap();
    let before = repository.read().await;
    let mut d = draft();
    d.id = Some("c1".into());
    d.base_url = "https://other.example/v1".into();
    assert!(editor.save(d, true).await.is_err());
    assert_eq!(repository.read().await, before);
    assert_eq!(
        secrets
            .get("c1", "https://api.deepseek.com")
            .await
            .unwrap()
            .as_deref(),
        Some("old-key")
    );
}
#[tokio::test]
async fn remove_deletes_connection_and_secret() {
    let (editor, repository, secrets) = editor(settings(), RecordingTransport::models());
    secrets
        .set("key", "c1", "https://api.deepseek.com")
        .await
        .unwrap();
    editor.remove("c1").await.unwrap();
    assert!(!editor.key_state("c1").await.unwrap());
    let s = repository.read().await;
    assert!(s.connections.is_empty());
    assert!(s.active_connection_id.is_none());
}

struct ControlledSecrets {
    inner: MemorySecretStore,
    block: bool,
    deletes: std::sync::atomic::AtomicUsize,
}
impl ControlledSecrets {
    async fn interrupt(&self) -> Result<(), SecretError> {
        if self.block {
            std::future::pending::<()>().await;
        }
        Err(SecretError::Unavailable("store failure".into()))
    }
}
impl SecretStore for ControlledSecrets {
    async fn set(&self, _: &str, _: &str, _: &str) -> Result<(), SecretError> {
        self.interrupt().await
    }
    async fn get(&self, connection_id: &str, origin: &str) -> Result<Option<String>, SecretError> {
        self.inner.get(connection_id, origin).await
    }
    async fn has(&self, connection_id: &str) -> Result<bool, SecretError> {
        self.inner.has(connection_id).await
    }
    async fn delete(&self, _: &str) -> Result<(), SecretError> {
        self.deletes
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        self.interrupt().await
    }
}
#[tokio::test]
async fn interrupted_secret_write_keeps_new_settings_without_deleting_the_old_key() {
    use std::{
        future::{Future, poll_fn},
        sync::atomic::{AtomicUsize, Ordering},
        task::Poll,
    };
    for block in [false, true] {
        let repository = Arc::new(MemorySettingsRepository::new(settings()));
        let secrets = Arc::new(ControlledSecrets {
            inner: MemorySecretStore::new(),
            block,
            deletes: AtomicUsize::new(0),
        });
        secrets
            .inner
            .set("old-key", "c1", "https://api.deepseek.com")
            .await
            .unwrap();
        let editor = ConnectionEditor::new(
            repository.clone(),
            secrets.clone(),
            RecordingTransport::models(),
        );
        let mut d = draft();
        d.id = Some("c1".into());
        d.base_url = "https://other.example/v1".into();
        d.api_key = "new-key".into();
        let mut future = Box::pin(editor.save(d, true));
        if block {
            poll_fn(|cx| {
                assert!(future.as_mut().poll(cx).is_pending());
                Poll::Ready(())
            })
            .await;
            drop(future);
        } else {
            assert!(future.await.is_err());
        }
        assert_eq!(
            repository.read().await.connections[0].base_url,
            "https://other.example/v1"
        );
        assert_eq!(secrets.deletes.load(Ordering::SeqCst), 0);
        assert_eq!(
            secrets
                .inner
                .get("c1", "https://api.deepseek.com")
                .await
                .unwrap()
                .as_deref(),
            Some("old-key")
        );
        assert_eq!(
            secrets.inner.get("c1", "https://other.example").await,
            Err(SecretError::OriginMismatch)
        );
    }
}
#[tokio::test]
async fn interrupted_secret_delete_keeps_the_connection_removed() {
    use std::{
        future::{Future, poll_fn},
        sync::atomic::AtomicUsize,
        task::Poll,
    };
    for block in [false, true] {
        let repository = Arc::new(MemorySettingsRepository::new(settings()));
        let secrets = Arc::new(ControlledSecrets {
            inner: MemorySecretStore::new(),
            block,
            deletes: AtomicUsize::new(0),
        });
        secrets
            .inner
            .set("old-key", "c1", "https://api.deepseek.com")
            .await
            .unwrap();
        let editor = ConnectionEditor::new(
            repository.clone(),
            secrets.clone(),
            RecordingTransport::models(),
        );
        let mut future = Box::pin(editor.remove("c1"));
        if block {
            poll_fn(|cx| {
                assert!(future.as_mut().poll(cx).is_pending());
                Poll::Ready(())
            })
            .await;
            drop(future);
        } else {
            assert!(future.await.is_err());
        }
        assert!(repository.read().await.connections.is_empty());
        assert!(secrets.inner.has("c1").await.unwrap());
    }
}
#[tokio::test]
async fn models_refuses_insecure_remote_urls_before_consent_or_io() {
    let mut s = settings();
    s.connections[0].base_url = "http://evil.example/v1".into();
    for consent in [false, true] {
        if consent {
            s.consented_origins.push("http://evil.example".into());
        }
        let transport = RecordingTransport::models();
        let (editor, _, _) = editor(s.clone(), transport.clone());
        assert!(matches!(
            editor.models("c1").await,
            Err(RunnerError::Backend(_))
        ));
        assert!(transport.requests.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn reentering_a_key_repairs_an_interrupted_origin_change() {
    let mut s = settings();
    s.connections[0].base_url = "https://other.example/v1".into();
    let (editor, _, secrets) = editor(s, RecordingTransport::models());
    secrets
        .set("old-key", "c1", "https://api.deepseek.com")
        .await
        .unwrap();
    let mut d = draft();
    d.id = Some("c1".into());
    d.base_url = "https://other.example/v1".into();
    d.api_key = "new-key".into();
    editor.save(d, true).await.unwrap();
    assert_eq!(
        secrets
            .get("c1", "https://other.example")
            .await
            .unwrap()
            .as_deref(),
        Some("new-key")
    );
}
