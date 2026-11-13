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
async fn a_corrupt_file_is_replaced() {
    let temp = Temp::new();
    fs::write(temp.0.join("settings.json"), "broken").unwrap();
    let settings = temp.repo().update(Box::new(|s| s)).await;
    let bytes = fs::read(temp.0.join("settings.json")).unwrap();
    assert_eq!(
        serde_json::from_slice::<AppSettings>(&bytes).unwrap(),
        settings
    );
}
