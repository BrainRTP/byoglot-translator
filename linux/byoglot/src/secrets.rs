use crate::APP_ID;
use byoglot_core::{MemorySecretStore, SecretError, SecretStore};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fmt};

pub struct KeyringSecretStore {
    keyring: oo7::Keyring,
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
        let keyring = oo7::Keyring::host().await.map_err(unavailable)?;
        keyring.unlock().await.map_err(unavailable)?;
        Ok(Self { keyring })
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
        if let Some(item) = items.first() {
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
        let items = self
            .keyring
            .search_items(&attributes(connection_id))
            .await
            .map_err(unavailable)?;
        let Some(item) = items.first() else {
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
        self.keyring
            .delete(&attributes(connection_id))
            .await
            .map_err(unavailable)
    }
}

pub struct FallbackSecretStore {
    persistent: Option<KeyringSecretStore>,
    memory: MemorySecretStore,
}
impl FallbackSecretStore {
    pub async fn open() -> Self {
        let persistent = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            KeyringSecretStore::open(),
        )
        .await
        .ok()
        .and_then(Result::ok);
        Self {
            persistent,
            memory: MemorySecretStore::new(),
        }
    }
    pub fn memory() -> Self {
        Self {
            persistent: None,
            memory: MemorySecretStore::new(),
        }
    }
    pub fn is_persistent(&self) -> bool {
        self.persistent.is_some()
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
        if let Some(store) = &self.persistent {
            store.set(secret, id, origin).await
        } else {
            self.memory.set(secret, id, origin).await
        }
    }
    async fn get(&self, id: &str, origin: &str) -> Result<Option<String>, SecretError> {
        if let Some(store) = &self.persistent {
            store.get(id, origin).await
        } else {
            self.memory.get(id, origin).await
        }
    }
    async fn has(&self, id: &str) -> Result<bool, SecretError> {
        if let Some(store) = &self.persistent {
            store.has(id).await
        } else {
            self.memory.has(id).await
        }
    }
    async fn delete(&self, id: &str) -> Result<(), SecretError> {
        if let Some(store) = &self.persistent {
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
        let store = FallbackSecretStore::memory();
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
