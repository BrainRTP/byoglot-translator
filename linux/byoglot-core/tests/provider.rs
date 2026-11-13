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
        if models
            != serde_json::from_value::<Vec<ModelInfo>>(case.expected["models"].clone()).unwrap()
            || default
                != serde_json::from_value::<Option<ModelInfo>>(
                    case.expected["defaultModel"].clone(),
                )
                .unwrap()
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
        let actual = client.list_models().await.unwrap_err();
        let expected_request = json!({"method": "GET", "url": "https://api.deepseek.com/models", "headers": {"authorization": "Bearer fixture-key"}});
        if actual != serde_json::from_value::<BackendError>(case.expected.clone()).unwrap()
            || transport.request_value(0) != expected_request
        {
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
        "fc00::1",
        "fdff::1",
        "fe80::1",
        "febf::1",
    ] {
        assert!(is_local_host(host), "{host}");
    }
    for host in [
        "172.15.0.1",
        "172.32.0.1",
        "8.8.8.8",
        "localhost.example",
        "example.com",
        "fbff::1",
        "fe7f::1",
        "fec0::1",
        "2001:db8::1",
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

#[tokio::test]
async fn provider_refuses_insecure_remote_requests_and_allows_lan() {
    for base_url in ["http://evil.example/v1", "broken url"] {
        let mut c = connection();
        c.base_url = base_url.into();
        let transport = RecordingTransport::models();
        let client = ProviderClient::new(c, None, transport.clone(), fixed_now);
        assert_eq!(
            client.list_models().await.unwrap_err().kind,
            ErrorKind::Incompatible
        );
        assert_eq!(
            client.generate("hello", &model()).await.unwrap_err().kind,
            ErrorKind::Incompatible
        );
        assert!(transport.requests.lock().unwrap().is_empty());
    }
    for base_url in [
        "http://192.168.1.1/v1",
        "http://[fd00::1]/v1",
        "http://[fe80::1]/v1",
    ] {
        let mut c = connection();
        c.base_url = base_url.into();
        let transport = RecordingTransport::models();
        assert!(
            ProviderClient::new(c, None, transport.clone(), fixed_now)
                .list_models()
                .await
                .is_ok()
        );
        assert_eq!(transport.requests.lock().unwrap().len(), 1);
    }
}
#[test]
fn custom_key_requirement_matches_the_typescript_loopback_allowlist() {
    for host in ["localhost", "127.0.0.1"] {
        assert!(!needs_key(
            ProviderPreset::Custom,
            &format!("http://{host}:8080/v1")
        ));
    }
    for host in [
        "127.2.3.4",
        "10.0.0.1",
        "172.16.0.1",
        "192.168.0.1",
        "169.254.0.1",
        "box.local",
        "[::1]",
        "[fc00::1]",
        "[fe80::1]",
        "localhost.",
    ] {
        assert!(
            needs_key(ProviderPreset::Custom, &format!("http://{host}/v1")),
            "{host}"
        );
    }
}
#[test]
fn response_debug_hides_body_and_authorization() {
    let response = HttpResponse {
        status: 401,
        headers: [
            ("Authorization".into(), "Bearer secret".into()),
            ("content-type".into(), "text/plain".into()),
        ]
        .into(),
        body: b"private prompt".to_vec(),
    };
    let debug = format!("{response:?}");
    assert!(!debug.contains("private prompt"));
    assert!(!debug.contains(&format!("{:?}", response.body)));
    assert!(!debug.contains("Bearer secret"));
    assert!(debug.contains("body_bytes: 14"));
    assert!(debug.contains("content-type"));
}

#[tokio::test]
async fn numeric_model_metadata_preserves_typescript_number_values() {
    let transport = RecordingTransport::new(
        200,
        json!({"data": [
            {"id": "integral-float", "context_window": 131072.0, "max_output_tokens": 8192.0},
            {"id": "fractional-negative", "context_length": -1.5, "max_output_tokens": 0.5},
            {"id": "above-u32", "context_window": 4294967296.0, "max_output_tokens": 1e23}
        ]}),
    );
    let models = ProviderClient::new(connection(), None, transport, fixed_now)
        .list_models()
        .await
        .unwrap();
    assert_eq!(
        models
            .iter()
            .map(|m| (m.context_limit, m.output_limit))
            .collect::<Vec<_>>(),
        [(131072.0, 8192.0), (-1.5, 0.5), (4294967296.0, 1e23)]
    );
}
#[tokio::test]
async fn retry_after_caps_large_finite_and_overflowing_delays() {
    for (seconds, expected) in [
        ("99999999999999999999".into(), Some(86_400_000.0)),
        ("9".repeat(400), Some(86_400_000.0)),
    ] {
        let mut transport = RecordingTransport::new(429, json!({}));
        transport
            .response
            .as_mut()
            .unwrap()
            .headers
            .insert("retry-after".into(), seconds);
        let error = ProviderClient::new(connection(), None, transport, fixed_now)
            .list_models()
            .await
            .unwrap_err();
        assert_eq!(error.retry_after_ms, expected);
    }
}
