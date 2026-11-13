use crate::APP_ID;
use byoglot_core::{MemorySecretStore, SecretError, SecretStore};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fmt, future::Future};
use tokio::sync::{Mutex, OnceCell};

pub struct KeyringSecretStore {
    keyring: oo7::Keyring,
    access: Mutex<()>,
}

#[derive(Serialize, Deserialize)]
struct StoredSecret {
    origin: String,
    key: String,
}

fn unavailable(_: impl Sized) -> SecretError {
    SecretError::Unavailable("keyring operation failed".into())
}
fn attributes(id: &str) -> HashMap<&str, &str> {
    HashMap::from([("app", APP_ID), ("connection-id", id)])
}

impl KeyringSecretStore {
    pub async fn open() -> Result<Self, SecretError> {
        let keyring = oo7::Keyring::new().await.map_err(unavailable)?;
        Ok(Self {
            keyring,
            access: Mutex::new(()),
        })
    }
}
impl fmt::Debug for KeyringSecretStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("KeyringSecretStore")
    }
}
impl SecretStore for KeyringSecretStore {
    async fn set(
        &self,
        secret: &str,
        connection_id: &str,
        origin: &str,
    ) -> Result<(), SecretError> {
        let _guard = self.access.lock().await;
        self.keyring.unlock().await.map_err(unavailable)?;
        let mut attrs = attributes(connection_id);
        attrs.insert("origin", origin);
        let value = serde_json::to_string(&StoredSecret {
            origin: origin.into(),
            key: secret.into(),
        })
        .map_err(unavailable)?;
        let items = self
            .keyring
            .search_items(&attributes(connection_id))
            .await
            .map_err(unavailable)?;
        if let Some(item) = unique_item(&items)? {
            // Bind origin and key in one atomic Secret Service write.
            item.set_secret(value).await.map_err(unavailable)?;
            let _ = item.set_attributes(&attrs).await;
        } else {
            self.keyring
                .create_item("ByoGlot", &attrs, value, true)
                .await
                .map_err(unavailable)?;
        }
        Ok(())
    }
    async fn get(&self, connection_id: &str, origin: &str) -> Result<Option<String>, SecretError> {
        let _guard = self.access.lock().await;
        self.keyring.unlock().await.map_err(unavailable)?;
        let items = self
            .keyring
            .search_items(&attributes(connection_id))
            .await
            .map_err(unavailable)?;
        let Some(item) = unique_item(&items)? else {
            return Ok(None);
        };
        let secret = item.secret().await.map_err(unavailable)?;
        let stored: StoredSecret =
            serde_json::from_slice(secret.as_bytes()).map_err(unavailable)?;
        if stored.origin != origin {
            return Err(SecretError::OriginMismatch);
        }
        Ok(Some(stored.key))
    }
    async fn has(&self, connection_id: &str) -> Result<bool, SecretError> {
        Ok(!self
            .keyring
            .search_items(&attributes(connection_id))
            .await
            .map_err(unavailable)?
            .is_empty())
    }
    async fn delete(&self, connection_id: &str) -> Result<(), SecretError> {
        let _guard = self.access.lock().await;
        self.keyring.unlock().await.map_err(unavailable)?;
        self.keyring
            .delete(&attributes(connection_id))
            .await
            .map_err(unavailable)
    }
}

fn unique_item<T>(items: &[T]) -> Result<Option<&T>, SecretError> {
    match items {
        [] => Ok(None),
        [item] => Ok(Some(item)),
        _ => Err(unavailable(())),
    }
}

pub struct FallbackSecretStore {
    persistent: OnceCell<Option<KeyringSecretStore>>,
    memory: MemorySecretStore,
}
impl FallbackSecretStore {
    pub fn lazy() -> Self {
        Self {
            persistent: OnceCell::new(),
            memory: MemorySecretStore::new(),
        }
    }
    pub async fn open() -> Self {
        Self::open_with(KeyringSecretStore::open()).await
    }
    pub async fn open_with(
        open: impl Future<Output = Result<KeyringSecretStore, SecretError>>,
    ) -> Self {
        Self {
            persistent: OnceCell::new_with(Some(open.await.ok())),
            memory: MemorySecretStore::new(),
        }
    }
    pub async fn initialize(&self) {
        self.backend().await;
    }
    async fn backend(&self) -> Option<&KeyringSecretStore> {
        self.persistent
            .get_or_init(|| async { KeyringSecretStore::open().await.ok() })
            .await
            .as_ref()
    }
    pub fn memory() -> Self {
        Self {
            persistent: OnceCell::new_with(Some(None)),
            memory: MemorySecretStore::new(),
        }
    }
    pub fn is_persistent(&self) -> bool {
        self.persistent.get().is_none_or(Option::is_some)
    }
}
impl fmt::Debug for FallbackSecretStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("FallbackSecretStore")
            .field("persistent", &self.is_persistent())
            .finish()
    }
}
impl SecretStore for FallbackSecretStore {
    async fn set(&self, secret: &str, id: &str, origin: &str) -> Result<(), SecretError> {
        if let Some(store) = self.backend().await {
            store.set(secret, id, origin).await
        } else {
            self.memory.set(secret, id, origin).await
        }
    }
    async fn get(&self, id: &str, origin: &str) -> Result<Option<String>, SecretError> {
        if let Some(store) = self.backend().await {
            store.get(id, origin).await
        } else {
            self.memory.get(id, origin).await
        }
    }
    async fn has(&self, id: &str) -> Result<bool, SecretError> {
        if let Some(store) = self.backend().await {
            store.has(id).await
        } else {
            self.memory.has(id).await
        }
    }
    async fn delete(&self, id: &str) -> Result<(), SecretError> {
        if let Some(store) = self.backend().await {
            store.delete(id).await
        } else {
            self.memory.delete(id).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn falls_back_to_memory_and_reports_not_persistent() {
        let store = FallbackSecretStore::open_with(async { Err(unavailable(())) }).await;
        assert!(!store.is_persistent());
        store
            .set("private-key", "c", "https://example.com")
            .await
            .unwrap();
        assert_eq!(
            store
                .get("c", "https://example.com")
                .await
                .unwrap()
                .as_deref(),
            Some("private-key")
        );
        assert!(!format!("{store:?}").contains("private-key"));
        store.delete("c").await.unwrap();
        assert!(!store.has("c").await.unwrap());
    }
    #[test]
    fn duplicate_items_are_never_selected_arbitrarily() {
        assert!(unique_item(&[1, 2]).is_err());
        assert_eq!(unique_item(&[1]).unwrap(), Some(&1));
    }
    #[test]
    fn lazy_store_does_not_open_or_prompt_at_construction() {
        let store = FallbackSecretStore::lazy();
        assert!(store.persistent.get().is_none());
    }
    #[tokio::test]
    async fn origin_mismatch_is_reported() {
        let store = FallbackSecretStore::memory();
        store
            .set("secret", "c", "https://one.example")
            .await
            .unwrap();
        assert_eq!(
            store.get("c", "https://two.example").await,
            Err(SecretError::OriginMismatch)
        );
    }
}
