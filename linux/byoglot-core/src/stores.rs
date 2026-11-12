use crate::AppSettings;
use std::{
    collections::HashMap,
    fmt,
    future::Future,
    sync::{Arc, Mutex},
};

#[derive(Clone, Debug, PartialEq, thiserror::Error)]
pub enum SecretError {
    #[error("secret origin differs")]
    OriginMismatch,
    #[error("secret store unavailable")]
    Unavailable(String),
}
pub trait SecretStore: Sync {
    fn set(
        &self,
        secret: &str,
        connection_id: &str,
        origin: &str,
    ) -> impl Future<Output = Result<(), SecretError>> + Send;
    fn get(
        &self,
        connection_id: &str,
        origin: &str,
    ) -> impl Future<Output = Result<Option<String>, SecretError>> + Send;
    fn has(&self, connection_id: &str) -> impl Future<Output = Result<bool, SecretError>> + Send;
    fn delete(&self, connection_id: &str) -> impl Future<Output = Result<(), SecretError>> + Send;
}
pub trait SettingsRepository: Sync {
    fn read(&self) -> impl Future<Output = AppSettings> + Send;
    fn update(
        &self,
        change: Box<dyn FnOnce(AppSettings) -> AppSettings + Send>,
    ) -> impl Future<Output = AppSettings> + Send;
}
#[derive(Default)]
pub struct MemorySecretStore {
    secrets: Mutex<HashMap<String, (String, String)>>,
}
impl MemorySecretStore {
    pub fn new() -> Self {
        Self::default()
    }
}
impl fmt::Debug for MemorySecretStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MemorySecretStore")
            .field("count", &self.secrets.lock().unwrap().len())
            .finish()
    }
}
impl SecretStore for MemorySecretStore {
    async fn set(
        &self,
        secret: &str,
        connection_id: &str,
        origin: &str,
    ) -> Result<(), SecretError> {
        self.secrets
            .lock()
            .unwrap()
            .insert(connection_id.into(), (origin.into(), secret.into()));
        Ok(())
    }
    async fn get(&self, connection_id: &str, origin: &str) -> Result<Option<String>, SecretError> {
        match self.secrets.lock().unwrap().get(connection_id) {
            Some((stored_origin, _)) if stored_origin != origin => Err(SecretError::OriginMismatch),
            Some((_, secret)) => Ok(Some(secret.clone())),
            None => Ok(None),
        }
    }
    async fn has(&self, connection_id: &str) -> Result<bool, SecretError> {
        Ok(self.secrets.lock().unwrap().contains_key(connection_id))
    }
    async fn delete(&self, connection_id: &str) -> Result<(), SecretError> {
        self.secrets.lock().unwrap().remove(connection_id);
        Ok(())
    }
}
#[derive(Debug)]
pub struct MemorySettingsRepository {
    settings: Mutex<AppSettings>,
}
impl MemorySettingsRepository {
    pub fn new(settings: AppSettings) -> Self {
        Self {
            settings: Mutex::new(settings),
        }
    }
}
impl Default for MemorySettingsRepository {
    fn default() -> Self {
        Self::new(AppSettings::initial(None))
    }
}
impl SettingsRepository for MemorySettingsRepository {
    async fn read(&self) -> AppSettings {
        self.settings.lock().unwrap().clone()
    }
    async fn update(
        &self,
        change: Box<dyn FnOnce(AppSettings) -> AppSettings + Send>,
    ) -> AppSettings {
        let mut settings = self.settings.lock().unwrap();
        *settings = change(settings.clone());
        settings.clone()
    }
}
impl<S: SettingsRepository + Send> SettingsRepository for Arc<S> {
    fn read(&self) -> impl Future<Output = AppSettings> + Send {
        (**self).read()
    }
    fn update(
        &self,
        change: Box<dyn FnOnce(AppSettings) -> AppSettings + Send>,
    ) -> impl Future<Output = AppSettings> + Send {
        (**self).update(change)
    }
}
impl<K: SecretStore + Send> SecretStore for Arc<K> {
    fn set(
        &self,
        secret: &str,
        connection_id: &str,
        origin: &str,
    ) -> impl Future<Output = Result<(), SecretError>> + Send {
        (**self).set(secret, connection_id, origin)
    }
    fn get(
        &self,
        connection_id: &str,
        origin: &str,
    ) -> impl Future<Output = Result<Option<String>, SecretError>> + Send {
        (**self).get(connection_id, origin)
    }
    fn has(&self, connection_id: &str) -> impl Future<Output = Result<bool, SecretError>> + Send {
        (**self).has(connection_id)
    }
    fn delete(&self, connection_id: &str) -> impl Future<Output = Result<(), SecretError>> + Send {
        (**self).delete(connection_id)
    }
}
