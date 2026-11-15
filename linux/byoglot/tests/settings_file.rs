use byoglot::settings_file::FileSettingsRepository;
use byoglot_core::{AppSettings, SettingsRepository};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "byoglot-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn repo(&self) -> FileSettingsRepository {
        FileSettingsRepository::new(self.0.join("settings.json"), Some("ru_RU".into()))
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
#[tokio::test]
async fn creates_initial_settings() {
    let temp = Temp::new();
    assert_eq!(
        temp.repo().read().await,
        AppSettings::initial(Some("ru_RU"))
    );
}
#[tokio::test]
async fn update_persists_across_instances() {
    let temp = Temp::new();
    temp.repo()
        .update(Box::new(|mut s| {
            s.globals.target_lang = "de".into();
            s
        }))
        .await;
    assert_eq!(temp.repo().read().await.globals.target_lang, "de");
    assert!(!temp.0.join("settings.json.tmp").exists());
}
#[tokio::test]
async fn corrupt_or_future_settings_are_preserved_and_cannot_be_overwritten() {
    let temp = Temp::new();
    let path = temp.0.join("settings.json");
    let mut future = AppSettings::initial(None);
    future.schema_version = 2;
    for bytes in [
        "broken".to_string(),
        serde_json::to_string(&future).unwrap(),
    ] {
        fs::write(&path, &bytes).unwrap();
        let repo = temp.repo();
        assert!(repo.try_read().is_err());
        assert!(matches!(
            byoglot::services::Services::new(path.clone(), None, tokio::runtime::Handle::current())
                .await,
            Err(byoglot_core::RunnerError::Storage)
        ));
        assert!(repo.try_update(|s| s).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), bytes);
        assert_eq!(
            fs::read_to_string(path.with_extension("json.bad")).unwrap(),
            bytes
        );
        fs::write(&path, "different corruption").unwrap();
        assert!(repo.try_update(|s| s).is_err());
        assert_eq!(
            fs::read_to_string(path.with_extension("json.bad")).unwrap(),
            bytes
        );
        fs::remove_file(path.with_extension("json.bad")).unwrap();
    }
}

#[tokio::test]
async fn stored_settings_accept_new_fields_without_losing_connections_or_templates() {
    let temp = Temp::new();
    let mut settings = serde_json::to_value(AppSettings::initial(None)).unwrap();
    settings["globals"]["future"] = true.into();
    settings["templates"][0]["future"] = true.into();
    settings["templates"][0]["settings"]["future"] = true.into();
    settings["connections"] = serde_json::json!([{
        "id": "c", "preset": "custom", "name": "Saved", "baseUrl": "https://example.com",
        "selectionModel": {"providerID": "custom", "id": "m", "future": true}, "future": true
    }]);
    fs::write(temp.0.join("settings.json"), settings.to_string()).unwrap();
    let repo = temp.repo();
    let loaded = repo.try_read().unwrap();
    assert_eq!(loaded.connections.len(), 1);
    assert_eq!(loaded.templates.len(), 1);
    repo.try_update(|s| s).unwrap();
    assert_eq!(repo.read().await, loaded);
}
