use byoglot_core::{AppSettings, SettingsRepository};
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

pub struct FileSettingsRepository {
    path: PathBuf,
    preferred_language: Option<String>,
    lock: Mutex<()>,
}

impl FileSettingsRepository {
    pub fn new(path: PathBuf, preferred_language: Option<String>) -> Self {
        Self {
            path,
            preferred_language,
            lock: Mutex::new(()),
        }
    }

    fn load(&self) -> AppSettings {
        fs::read(&self.path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_else(|| AppSettings::initial(self.preferred_language.as_deref()))
    }

    pub fn try_update(
        &self,
        change: impl FnOnce(AppSettings) -> AppSettings,
    ) -> io::Result<AppSettings> {
        let _guard = self.lock.lock().unwrap();
        let settings = change(self.load());
        let parent = self.path.parent().unwrap_or(Path::new("."));
        fs::create_dir_all(parent)?;
        let temporary = self.path.with_extension("json.tmp");
        let result = (|| {
            let bytes = serde_json::to_vec_pretty(&settings)?;
            let mut options = fs::OpenOptions::new();
            options.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            fs::rename(&temporary, &self.path)?;
            Ok(settings)
        })();
        if result.is_err() {
            let _ = fs::remove_file(temporary);
        }
        result
    }
}

impl SettingsRepository for FileSettingsRepository {
    async fn read(&self) -> AppSettings {
        let _guard = self.lock.lock().unwrap();
        self.load()
    }
    async fn update(
        &self,
        change: Box<dyn FnOnce(AppSettings) -> AppSettings + Send>,
    ) -> AppSettings {
        self.try_update(change).unwrap_or_else(|_| self.load())
    }
}
