use byoglot_core::{AppSettings, SettingsRepository};
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[derive(Clone)]
pub struct FileSettingsRepository {
    path: PathBuf,
    preferred_language: Option<String>,
    lock: Arc<Mutex<()>>,
}

impl FileSettingsRepository {
    pub fn new(path: PathBuf, preferred_language: Option<String>) -> Self {
        Self {
            path,
            preferred_language,
            lock: Arc::new(Mutex::new(())),
        }
    }

    fn load(&self) -> io::Result<AppSettings> {
        let bytes = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(AppSettings::initial(self.preferred_language.as_deref()));
            }
            Err(error) => return Err(error),
        };
        let settings = serde_json::from_slice::<AppSettings>(&bytes);
        if let Ok(settings) = settings
            && settings.schema_version == 1
        {
            return Ok(settings);
        }
        Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid settings or schema version",
        ))
    }

    pub fn try_read(&self) -> io::Result<AppSettings> {
        let _guard = self.lock.lock().unwrap();
        self.load()
    }

    pub fn reset_invalid(&self) -> io::Result<PathBuf> {
        let _guard = self.lock.lock().unwrap();
        match self.load() {
            Err(error) if error.kind() == io::ErrorKind::InvalidData => (),
            Err(error) => return Err(error),
            Ok(_) => return Err(io::Error::other("settings are not invalid")),
        }
        let mut backup = self.path.with_extension("json.bad");
        let mut number = 0;
        loop {
            // A hard link preserves the file without replacing any earlier backup.
            match fs::hard_link(&self.path, &backup) {
                Ok(()) => {
                    fs::remove_file(&self.path)?;
                    return Ok(backup);
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                    number += 1;
                    backup = self.path.with_extension(format!("json.bad.{number}"));
                }
                Err(error) => return Err(error),
            }
        }
    }

    pub fn try_update(
        &self,
        change: impl FnOnce(AppSettings) -> AppSettings,
    ) -> io::Result<AppSettings> {
        let _guard = self.lock.lock().unwrap();
        let settings = change(self.load()?);
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
        let repository = self.clone();
        tokio::task::spawn_blocking(move || repository.try_read())
            .await
            .ok()
            .and_then(Result::ok)
            .unwrap_or_else(|| AppSettings::initial(self.preferred_language.as_deref()))
    }
    async fn update(
        &self,
        change: Box<dyn FnOnce(AppSettings) -> AppSettings + Send>,
    ) -> AppSettings {
        let repository = self.clone();
        match tokio::task::spawn_blocking(move || repository.try_update(change)).await {
            Ok(Ok(settings)) => settings,
            _ => self.read().await,
        }
    }
}
