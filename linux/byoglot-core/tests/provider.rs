mod common;
use byoglot_core::*;
use common::*;
use serde_json::{Value, json};
use std::time::Duration;

#[tokio::test]
async fn model_contract_cases() {
    let mut failures = Vec::new();
    for case in fixture::<Value, Value>("provider-models") {
        let (client, transport) = fixture_client(&case.input);
        let models = client.list_models().await.unwrap();
        let default = client.default_model().await.unwrap();
        if json!(models) != case.expected["models"]
            || json!(default) != case.expected["defaultModel"]
            || transport.request_value(0) != case.expected["request"]
            || transport.request_value(1) != case.expected["request"]
        {
            failures.push(case.name);
        }
        assert_eq!(
            transport.requests.lock().unwrap()[0].1,
            Duration::from_secs(30)
        );
    }
    assert!(failures.is_empty(), "failed cases: {failures:?}");
}
#[tokio::test]
async fn chat_contract_cases() {
    let mut failures = Vec::new();
    for case in fixture::<Value, Value>("provider-chat") {
        let (client, transport) = fixture_client(&case.input);
        let model = serde_json::from_value(case.input["model"].clone()).unwrap();
        let actual = match client
            .generate(case.input["prompt"].as_str().unwrap(), &model)
            .await
        {
            Ok(content) => json!({"content": content}),
            Err(error) => json!({"error": error}),
        };
        if actual != case.expected["result"]
            || transport.request_value(0) != case.expected["request"]
        {
            failures.push((case.name, actual));
        }
        assert_eq!(
            transport.requests.lock().unwrap()[0].1,
            Duration::from_millis(contracts::limits().generate_timeout_ms)
        );
    }
    assert!(failures.is_empty(), "failed cases: {failures:?}");
}
#[tokio::test]
async fn error_contract_cases() {
    let mut failures = Vec::new();
    for case in fixture::<Value, Value>("provider-errors") {
        if let Some(now) = case.input["now"].as_str() {
            assert_eq!(now, "2026-01-01T00:00:00.000Z");
        }
        let (client, transport) = fixture_client(&case.input);
        let actual = json!(client.list_models().await.unwrap_err());
        let expected_request = json!({"method": "GET", "url": "https://api.deepseek.com/models", "headers": {"authorization": "Bearer fixture-key"}});
        if actual != case.expected || transport.request_value(0) != expected_request {
            failures.push((case.name, actual));
        }
    }
    assert!(failures.is_empty(), "failed cases: {failures:?}");
}
#[test]
fn effort_contract_cases() {
    let mut failures = Vec::new();
    for case in fixture::<Value, Value>("provider-effort") {
        let preset = serde_json::from_value(case.input["preset"].clone()).unwrap();
        let levels: Option<Vec<String>> =
            serde_json::from_value(case.input["rawModel"]["effort"]["supported_levels"].clone())
                .unwrap();
        let parameters: Option<Vec<String>> =
            serde_json::from_value(case.input["rawModel"]["supported_parameters"].clone()).unwrap();
        let actual = json!({"variants": effort_variants(preset, levels.as_deref(), parameters.as_deref()), "params": effort_params(preset, case.input["variant"].as_str()), "needsKey": needs_key(preset, case.input["baseUrl"].as_str().unwrap())});
        if actual != case.expected {
            failures.push((case.name, actual));
        }
    }
    assert!(failures.is_empty(), "failed cases: {failures:?}");
}
#[tokio::test]
async fn transport_errors_and_secret_redaction() {
    for (transport_error, kind) in [
        (TransportError::Offline, ErrorKind::Offline),
        (TransportError::Timeout, ErrorKind::Offline),
        (TransportError::Cancelled, ErrorKind::Aborted),
    ] {
        let mut transport = RecordingTransport::completion();
        transport.response = Err(transport_error);
        let client = ProviderClient::new(connection(), None, transport, fixed_now);
        assert_eq!(
            client.generate("hello", &model()).await.unwrap_err().kind,
            kind
        );
    }
    let transport =
        RecordingTransport::new(401, json!({"error":{"message":"rejected super-secret"}}));
    let client = ProviderClient::new(
        connection(),
        Some("super-secret".into()),
        transport.clone(),
        fixed_now,
    );
    assert!(!format!("{client:?}").contains("super-secret"));
    let error = client.list_models().await.unwrap_err();
    assert!(!format!("{error:?} {error}").contains("super-secret"));
    assert!(!format!("{:?}", transport.requests.lock().unwrap()[0].0).contains("super-secret"));
}
#[test]
fn local_hosts_and_origins() {
    for host in [
        "localhost",
        "127.4.5.6",
        "::1",
        "[::1]",
        "10.5.6.7",
        "172.16.0.1",
        "172.31.255.255",
        "192.168.2.1",
        "169.254.2.1",
        "box.local",
    ] {
        assert!(is_local_host(host), "{host}");
    }
    for host in [
        "172.15.0.1",
        "172.32.0.1",
        "8.8.8.8",
        "localhost.example",
        "example.com",
    ] {
        assert!(!is_local_host(host), "{host}");
    }
    assert_eq!(
        origin_of("HTTPS://EXAMPLE.COM:443/v1"),
        Some("https://example.com".into())
    );
    assert_eq!(
        origin_of("http://[::1]:8080/v1"),
        Some("http://[::1]:8080".into())
    );
    for url in [
        "broken url",
        "file:///tmp",
        "https://example.com:bad",
        "http://user:secret@example.com",
        "https://localhost\\@example.com",
        "http://[broken]",
    ] {
        assert_eq!(origin_of(url), None, "{url}");
    }
}
