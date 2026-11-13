use crate::{RunnerError, RunnerOutput};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextSource {
    Primary,
    Clipboard,
    Pasted,
    CommandLine,
}
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum QuickState {
    Hidden,
    WaitingForFocus,
    NeedsText,
    Translating {
        source: String,
    },
    Done {
        source: String,
        output: RunnerOutput,
    },
    Failed {
        source: String,
        error: RunnerError,
    },
    TooLong {
        limit: usize,
    },
}
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum QuickEvent {
    Triggered,
    TriggeredWithText(String),
    Focused,
    PrimaryRead(Option<String>),
    ClipboardRead(Option<String>),
    Pasted(String),
    Finished {
        source: String,
        output: RunnerOutput,
    },
    FailedWith {
        source: String,
        error: RunnerError,
    },
    Dismissed,
}
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QuickEffect {
    PresentWindow,
    ReadPrimary,
    ReadClipboard,
    StartTranslating(String),
    CancelTranslating,
}

pub fn reduce(
    state: QuickState,
    event: QuickEvent,
    limit: usize,
) -> (QuickState, Vec<QuickEffect>) {
    use QuickEffect::*;
    use QuickEvent::*;
    let cancel = || {
        if matches!(state, QuickState::Translating { .. }) {
            vec![CancelTranslating]
        } else {
            Vec::new()
        }
    };
    match event {
        Triggered => {
            let mut effects = cancel();
            effects.push(PresentWindow);
            (QuickState::WaitingForFocus, effects)
        }
        TriggeredWithText(text) => {
            let mut effects = cancel();
            effects.push(PresentWindow);
            text_rule(text, limit, effects)
        }
        Focused if state == QuickState::WaitingForFocus => (state, vec![ReadPrimary]),
        PrimaryRead(text) if state == QuickState::WaitingForFocus => {
            match text.filter(|t| !t.trim().is_empty()) {
                Some(text) => text_rule(text, limit, Vec::new()),
                None => (state, vec![ReadClipboard]),
            }
        }
        ClipboardRead(text) if state == QuickState::WaitingForFocus => {
            text_rule(text.unwrap_or_default(), limit, Vec::new())
        }
        Pasted(text) => text_rule(text, limit, cancel()),
        Finished {
            source: completed_source,
            output,
        } => match state {
            QuickState::Translating { source } if source == completed_source => {
                (QuickState::Done { source, output }, Vec::new())
            }
            _ => (state, Vec::new()),
        },
        FailedWith {
            source: completed_source,
            error,
        } => match state {
            QuickState::Translating { source } if source == completed_source => {
                (QuickState::Failed { source, error }, Vec::new())
            }
            _ => (state, Vec::new()),
        },
        Dismissed => (QuickState::Hidden, cancel()),
        _ => (state, Vec::new()),
    }
}
fn text_rule(
    text: String,
    limit: usize,
    mut effects: Vec<QuickEffect>,
) -> (QuickState, Vec<QuickEffect>) {
    let source = text.trim().to_owned();
    if source.is_empty() {
        (QuickState::NeedsText, effects)
    } else if source.encode_utf16().count() > limit {
        (QuickState::TooLong { limit }, effects)
    } else {
        effects.push(QuickEffect::StartTranslating(source.clone()));
        (QuickState::Translating { source }, effects)
    }
}

macro_rules! redacted_debug {
    ($($name:ident),+) => { $(
        impl std::fmt::Debug for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.debug_struct(stringify!($name)).field("kind", &std::mem::discriminant(self)).finish_non_exhaustive()
            }
        }
    )+ };
}
redacted_debug!(QuickState, QuickEvent, QuickEffect);
