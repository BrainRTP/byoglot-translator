mod common;
use QuickEffect::*;
use QuickEvent::*;
use byoglot_core::*;
use common::model;
const LIMIT: usize = QUICK_INPUT_LIMIT;
fn translating() -> QuickState {
    QuickState::Translating {
        source: "hello".into(),
    }
}
fn output() -> RunnerOutput {
    RunnerOutput {
        text: "translated".into(),
        source_lang: "auto".into(),
        target_lang: "ru".into(),
        model: model(),
    }
}

#[test]
fn trigger_presents_the_window_and_waits_for_focus() {
    assert_eq!(
        reduce(QuickState::Hidden, Triggered, LIMIT),
        (QuickState::WaitingForFocus, vec![PresentWindow])
    );
    assert_eq!(
        reduce(
            QuickState::Hidden,
            TriggeredWithText(" hello ".into()),
            LIMIT
        ),
        (
            translating(),
            vec![PresentWindow, StartTranslating("hello".into())]
        )
    );
}
#[test]
fn focus_reads_primary_first() {
    assert_eq!(
        reduce(QuickState::WaitingForFocus, Focused, LIMIT),
        (QuickState::WaitingForFocus, vec![ReadPrimary])
    );
    for state in [QuickState::Hidden, QuickState::NeedsText, translating()] {
        assert_eq!(reduce(state.clone(), Focused, LIMIT), (state, vec![]));
    }
}
#[test]
fn primary_text_starts_a_translation() {
    let (state, effects) = reduce(
        QuickState::WaitingForFocus,
        PrimaryRead(Some(" hello \n".into())),
        LIMIT,
    );
    assert_eq!(
        (state.clone(), effects),
        (translating(), vec![StartTranslating("hello".into())])
    );
    let result = output();
    assert_eq!(
        reduce(
            state.clone(),
            Finished {
                source: "hello".into(),
                output: result.clone()
            },
            LIMIT
        ),
        (
            QuickState::Done {
                source: "hello".into(),
                output: result
            },
            vec![]
        )
    );
    assert_eq!(
        reduce(
            state,
            FailedWith {
                source: "hello".into(),
                error: RunnerError::NoModel
            },
            LIMIT
        ),
        (
            QuickState::Failed {
                source: "hello".into(),
                error: RunnerError::NoModel
            },
            vec![]
        )
    );
}
#[test]
fn empty_primary_falls_back_to_the_clipboard() {
    let (state, effects) = reduce(QuickState::WaitingForFocus, PrimaryRead(None), LIMIT);
    assert_eq!(
        (state.clone(), effects),
        (QuickState::WaitingForFocus, vec![ReadClipboard])
    );
    assert_eq!(
        reduce(state, ClipboardRead(Some("hello".into())), LIMIT),
        (translating(), vec![StartTranslating("hello".into())])
    );
}
#[test]
fn empty_clipboard_asks_for_text() {
    assert_eq!(
        reduce(QuickState::WaitingForFocus, ClipboardRead(None), LIMIT),
        (QuickState::NeedsText, vec![])
    );
    assert_eq!(
        reduce(QuickState::NeedsText, Pasted("hello".into()), LIMIT),
        (translating(), vec![StartTranslating("hello".into())])
    );
}
#[test]
fn blank_text_counts_as_empty() {
    assert_eq!(
        reduce(
            QuickState::WaitingForFocus,
            PrimaryRead(Some(" \n\t".into())),
            LIMIT
        ),
        (QuickState::WaitingForFocus, vec![ReadClipboard])
    );
    for event in [ClipboardRead(Some(" \n".into())), Pasted(" \n".into())] {
        assert_eq!(
            reduce(QuickState::WaitingForFocus, event, LIMIT),
            (QuickState::NeedsText, vec![])
        );
    }
    assert_eq!(
        reduce(QuickState::Hidden, TriggeredWithText(" \n".into()), LIMIT),
        (QuickState::NeedsText, vec![PresentWindow])
    );
}
#[test]
fn long_text_is_refused() {
    for text in ["a".repeat(5001), format!("{}a", "😀".repeat(2500))] {
        for event in [
            Pasted(text.clone()),
            PrimaryRead(Some(text.clone())),
            ClipboardRead(Some(text)),
        ] {
            assert_eq!(
                reduce(QuickState::WaitingForFocus, event, LIMIT),
                (QuickState::TooLong { limit: LIMIT }, vec![])
            );
        }
    }
    let text = "😀".repeat(2500);
    assert_eq!(
        reduce(QuickState::NeedsText, Pasted(text.clone()), LIMIT),
        (
            QuickState::Translating {
                source: text.clone()
            },
            vec![StartTranslating(text)]
        )
    );
}
#[test]
fn a_new_trigger_cancels_the_running_translation() {
    assert_eq!(
        reduce(translating(), Triggered, LIMIT),
        (
            QuickState::WaitingForFocus,
            vec![CancelTranslating, PresentWindow]
        )
    );
    assert_eq!(
        reduce(translating(), TriggeredWithText("new".into()), LIMIT),
        (
            QuickState::Translating {
                source: "new".into()
            },
            vec![
                CancelTranslating,
                PresentWindow,
                StartTranslating("new".into())
            ]
        )
    );
    assert_eq!(
        reduce(translating(), Dismissed, LIMIT),
        (QuickState::Hidden, vec![CancelTranslating])
    );
}
#[test]
fn a_stale_read_after_paste_is_ignored() {
    let (state, _) = reduce(QuickState::WaitingForFocus, Pasted("hello".into()), LIMIT);
    for event in [
        PrimaryRead(Some("stale".into())),
        ClipboardRead(Some("stale".into())),
    ] {
        assert_eq!(reduce(state.clone(), event, LIMIT), (state.clone(), vec![]));
    }
}
#[test]
fn a_late_result_after_dismiss_is_ignored() {
    let (state, _) = reduce(translating(), Dismissed, LIMIT);
    for event in [
        Finished {
            source: "hello".into(),
            output: output(),
        },
        FailedWith {
            source: "hello".into(),
            error: RunnerError::NoModel,
        },
    ] {
        assert_eq!(
            reduce(state.clone(), event, LIMIT),
            (QuickState::Hidden, vec![])
        );
    }
}

#[test]
fn stale_completions_after_replacing_the_source_are_ignored() {
    for replacement in [Pasted("new".into()), TriggeredWithText("new".into())] {
        let (state, _) = reduce(translating(), replacement, LIMIT);
        for event in [
            Finished {
                source: "hello".into(),
                output: output(),
            },
            FailedWith {
                source: "hello".into(),
                error: RunnerError::NoModel,
            },
        ] {
            assert_eq!(reduce(state.clone(), event, LIMIT), (state.clone(), vec![]));
        }
        let mut result = output();
        result.text = "new translation".into();
        assert_eq!(
            reduce(
                state,
                Finished {
                    source: "new".into(),
                    output: result.clone()
                },
                LIMIT
            ),
            (
                QuickState::Done {
                    source: "new".into(),
                    output: result
                },
                vec![]
            )
        );
    }
}
