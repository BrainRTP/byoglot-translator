use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    Offline,
    Unauthorized,
    RateLimit,
    ProviderAuth,
    ProviderError,
    BadResponse,
    Incompatible,
    NoModel,
    Aborted,
}

impl ErrorKind {
    pub const ALL: [Self; 9] = [
        Self::Offline,
        Self::Unauthorized,
        Self::RateLimit,
        Self::ProviderAuth,
        Self::ProviderError,
        Self::BadResponse,
        Self::Incompatible,
        Self::NoModel,
        Self::Aborted,
    ];

    pub fn wire(&self) -> &'static str {
        match self {
            Self::Offline => "offline",
            Self::Unauthorized => "unauthorized",
            Self::RateLimit => "rate_limit",
            Self::ProviderAuth => "provider_auth",
            Self::ProviderError => "provider_error",
            Self::BadResponse => "bad_response",
            Self::Incompatible => "incompatible",
            Self::NoModel => "no_model",
            Self::Aborted => "aborted",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[error("{kind:?}")]
pub struct BackendError {
    pub kind: ErrorKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl BackendError {
    pub fn new(kind: ErrorKind) -> Self {
        Self {
            kind,
            status: None,
            retry_after_ms: None,
            detail: None,
        }
    }
    pub fn is_fatal(&self) -> bool {
        self.kind != ErrorKind::BadResponse
    }
}
