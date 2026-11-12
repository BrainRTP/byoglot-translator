mod common;
use byoglot_core::*;
use common::*;
use serde_json::Value;
use std::sync::Arc;

async fn run(
    s: AppSettings,
    secret: Option<(&str, &str)>,
    i: RunnerInput,
) -> (Result<RunnerOutput, RunnerError>, RecordingTransport) {
    let secrets = MemorySecretStore::new();
    if let Some((value, origin)) = secret {
        secrets.set(value, "c1", origin).await.unwrap();
    }
    let transport = RecordingTransport::completion();
    let runner =
        TranslationRunner::new(MemorySettingsRepository::new(s), secrets, transport.clone());
    (runner.translate(i).await, transport)
}
#[tokio::test]
async fn trims_input_and_rejects_empty_before_other_checks() {
    let mut i = input();
    i.text = " \n ".into();
    let (result, transport) = run(AppSettings::initial(None), None, i).await;
    assert_eq!(result, Err(RunnerError::Empty));
    assert!(transport.requests.lock().unwrap().is_empty());
}
#[tokio::test]
async fn utf16_limit_precedes_connection_check() {
    let mut i = input();
    i.text = "😀".repeat(2501);
    assert_eq!(
        run(AppSettings::initial(None), None, i).await.0,
        Err(RunnerError::TooLong { limit: 5000 })
    );
}
#[tokio::test]
async fn no_active_connection_is_reported() {
    assert_eq!(
        run(AppSettings::initial(None), None, input()).await.0,
        Err(RunnerError::NoConnection)
    );
}
#[tokio::test]
async fn template_default_builtin_and_target_precedence() {
    let mut s = settings();
    let mut template = contracts::builtin_template().clone();
    template.id = "study".into();
    template.settings.target_lang = Some("de".into());
    template.settings.pre_prompt = Some("be brief".into());
    s.templates.push(template);
    s.globals.default_template_id = "study".into();
    let mut i = input();
    i.template_id = Some("absent".into());
    let (result, transport) = run(
        s.clone(),
        Some(("key", "https://api.deepseek.com")),
        i.clone(),
    )
    .await;
    assert_eq!(result.unwrap().target_lang, "de");
    let body: Value = serde_json::from_slice(
        transport.requests.lock().unwrap()[0]
            .0
            .body
            .as_ref()
            .unwrap(),
    )
    .unwrap();
    assert!(
        body["messages"][0]["content"]
            .as_str()
            .unwrap()
            .contains("USER INSTRUCTIONS:\nbe brief")
    );
    i.template_id = Some("builtin-default".into());
    i.target_lang = Some("fr".into());
    assert_eq!(
        run(
            s.clone(),
            Some(("key", "https://api.deepseek.com")),
            i.clone()
        )
        .await
        .0
        .unwrap()
        .target_lang,
        "fr"
    );
    s.templates.clear();
    i.target_lang = None;
    assert_eq!(
        run(s, Some(("key", "https://api.deepseek.com")), i)
            .await
            .0
            .unwrap()
            .target_lang,
        "ru"
    );
}
#[tokio::test]
async fn no_model_precedes_consent_and_key_checks() {
    let mut s = settings();
    s.connections[0].selection_model = None;
    s.consented_origins.clear();
    assert_eq!(run(s, None, input()).await.0, Err(RunnerError::NoModel));
}
#[tokio::test]
async fn remote_origin_needs_consent_and_local_origin_does_not() {
    let mut s = settings();
    s.consented_origins.clear();
    assert_eq!(
        run(s.clone(), None, input()).await.0,
        Err(RunnerError::ConsentNeeded {
            origin: "https://api.deepseek.com".into()
        })
    );
    s.connections[0].preset = ProviderPreset::Custom;
    s.connections[0].base_url = "http://192.168.1.2/v1".into();
    assert_eq!(
        run(s.clone(), None, input()).await.0,
        Err(RunnerError::KeyMissing)
    );
    assert!(
        run(s, Some(("key", "http://192.168.1.2")), input())
            .await
            .0
            .is_ok()
    );
}
#[tokio::test]
async fn missing_or_wrong_origin_key_is_rejected() {
    assert_eq!(
        run(settings(), None, input()).await.0,
        Err(RunnerError::KeyMissing)
    );
    assert_eq!(
        run(settings(), Some(("key", "https://other.example")), input())
            .await
            .0,
        Err(RunnerError::KeyMissing)
    );
}
#[tokio::test]
async fn builds_language_prompt_and_translates_with_selected_model() {
    let transport = RecordingTransport::completion();
    let secrets = Arc::new(MemorySecretStore::new());
    secrets
        .set("key", "c1", "https://api.deepseek.com")
        .await
        .unwrap();
    let repository = Arc::new(MemorySettingsRepository::new(settings()));
    let runner = TranslationRunner::new(repository, secrets, transport.clone());
    let output = runner.translate(input()).await.unwrap();
    assert_eq!(output.text, "translated");
    assert_eq!(output.model, model());
    let body: Value = serde_json::from_slice(
        transport.requests.lock().unwrap()[0]
            .0
            .body
            .as_ref()
            .unwrap(),
    )
    .unwrap();
    let prompt = body["messages"][0]["content"].as_str().unwrap();
    assert!(prompt.contains(&contracts::builtin_profiles()["ru"]));
    assert!(prompt.ends_with("TEXT:\nhello"));
    assert_eq!(output.source_lang, "auto");
}

#[tokio::test]
async fn insecure_remote_origins_are_refused_even_after_consent() {
    let mut s = settings();
    s.connections[0].preset = ProviderPreset::Ollama;
    s.connections[0].base_url = "http://evil.example/v1".into();
    for consent in [false, true] {
        if consent {
            s.consented_origins.push("http://evil.example".into());
        }
        let (result, transport) = run(s.clone(), None, input()).await;
        assert!(matches!(result, Err(RunnerError::Backend(_))));
        assert!(transport.requests.lock().unwrap().is_empty());
    }
}
