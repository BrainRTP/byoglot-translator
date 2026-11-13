use crate::i18n::{Msg, tr, tr_with};
use byoglot_core::{ErrorKind, RunnerError};

pub fn error_text(error: &RunnerError) -> String {
    match error {
        RunnerError::NoConnection => tr(Msg::ErrNoConnection).into(),
        RunnerError::NoModel => tr(Msg::ErrNoModel).into(),
        RunnerError::KeyMissing => tr(Msg::ErrKeyMissing).into(),
        RunnerError::ConsentNeeded { origin } => tr_with(Msg::ErrConsent, origin),
        RunnerError::TooLong { limit } => tr_with(Msg::ErrTooLong, &limit.to_string()),
        RunnerError::Empty => tr(Msg::ErrEmpty).into(),
        RunnerError::Backend(error) => match error.kind {
            ErrorKind::Offline => tr(Msg::ErrOffline).into(),
            ErrorKind::Unauthorized | ErrorKind::ProviderAuth => tr_with(
                Msg::ErrAuth,
                &error
                    .status
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "401".into()),
            ),
            ErrorKind::RateLimit => tr(Msg::ErrRateLimit).into(),
            ErrorKind::ProviderError => tr_with(
                Msg::ErrProvider,
                &error
                    .status
                    .map(|s| format!("HTTP {s}"))
                    .unwrap_or_else(|| tr(Msg::ProviderFailure).into()),
            ),
            ErrorKind::BadResponse => tr(Msg::ErrBadResponse).into(),
            ErrorKind::Incompatible => tr(Msg::ErrIncompatible).into(),
            ErrorKind::NoModel => tr(Msg::ErrNoModel).into(),
            ErrorKind::Aborted => tr(Msg::ErrAborted).into(),
        },
    }
}

pub fn connection_fix(error: &RunnerError) -> bool {
    matches!(
        error,
        RunnerError::NoConnection
            | RunnerError::NoModel
            | RunnerError::KeyMissing
            | RunnerError::ConsentNeeded { .. }
    ) || matches!(error, RunnerError::Backend(e) if matches!(e.kind, ErrorKind::Unauthorized | ErrorKind::ProviderAuth | ErrorKind::Incompatible | ErrorKind::NoModel))
}

#[cfg(test)]
mod tests {
    use super::*;
    use byoglot_core::BackendError;
    #[test]
    fn every_runner_error_is_mapped() {
        for (error, message) in [
            (RunnerError::NoConnection, Msg::ErrNoConnection),
            (RunnerError::NoModel, Msg::ErrNoModel),
            (RunnerError::KeyMissing, Msg::ErrKeyMissing),
            (RunnerError::Empty, Msg::ErrEmpty),
        ] {
            assert_eq!(error_text(&error), tr(message));
        }
        assert_eq!(
            error_text(&RunnerError::ConsentNeeded {
                origin: "https://example.com".into()
            }),
            tr_with(Msg::ErrConsent, "https://example.com")
        );
        assert_eq!(
            error_text(&RunnerError::TooLong { limit: 20000 }),
            tr_with(Msg::ErrTooLong, "20000")
        );
    }
    #[test]
    fn every_provider_kind_is_mapped_without_private_details() {
        for kind in ErrorKind::ALL {
            let message = match kind {
                ErrorKind::Offline => Msg::ErrOffline,
                ErrorKind::Unauthorized | ErrorKind::ProviderAuth => Msg::ErrAuth,
                ErrorKind::RateLimit => Msg::ErrRateLimit,
                ErrorKind::ProviderError => Msg::ErrProvider,
                ErrorKind::BadResponse => Msg::ErrBadResponse,
                ErrorKind::Incompatible => Msg::ErrIncompatible,
                ErrorKind::NoModel => Msg::ErrNoModel,
                ErrorKind::Aborted => Msg::ErrAborted,
            };
            let mut backend = BackendError::new(kind);
            backend.status = Some(403);
            backend.detail = Some("private-key private-text".into());
            let error = RunnerError::Backend(backend);
            let expected = match kind {
                ErrorKind::Unauthorized | ErrorKind::ProviderAuth => tr_with(message, "403"),
                ErrorKind::ProviderError => tr_with(message, "HTTP 403"),
                _ => tr(message).into(),
            };
            assert_eq!(error_text(&error), expected);
            assert!(!format!("{error:?}").contains("private-"));
        }
    }
}
