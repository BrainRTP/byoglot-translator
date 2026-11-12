#![allow(dead_code)]
use byoglot_core::*;
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub fn contracts_dir() -> PathBuf {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    loop {
        if path.join("contracts/README.md").is_file() {
            return path.join("contracts");
        }
        assert!(path.pop(), "contracts/README.md not found");
    }
}
#[derive(Deserialize)]
pub struct Case<I, E> {
    pub name: String,
    pub input: I,
    pub expected: E,
}
#[derive(Deserialize)]
struct Fixture<I, E> {
    contract: String,
    version: u32,
    cases: Vec<Case<I, E>>,
}
pub fn fixture<I: DeserializeOwned, E: DeserializeOwned>(name: &str) -> Vec<Case<I, E>> {
    let file: Fixture<I, E> = serde_json::from_str(
        &std::fs::read_to_string(contracts_dir().join(format!("fixtures/{name}.json"))).unwrap(),
    )
    .unwrap();
    assert_eq!(file.contract, name);
    assert_eq!(file.version, 1);
    assert!(!file.cases.is_empty());
    file.cases
}
pub fn data(name: &str) -> Value {
    serde_json::from_str(
        &std::fs::read_to_string(contracts_dir().join(format!("{name}.json"))).unwrap(),
    )
    .unwrap()
}
pub fn fixed_now() -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(1767225600)
}
pub fn connection() -> Connection {
    Connection {
        id: "c1".into(),
        preset: ProviderPreset::Deepseek,
        name: "DeepSeek".into(),
        base_url: "https://api.deepseek.com".into(),
        page_model: Some(model()),
        selection_model: Some(model()),
    }
}
pub fn model() -> ModelRef {
    ModelRef {
        provider_id: "deepseek".into(),
        id: "deepseek-flash".into(),
        variant: Some("high".into()),
        connection_id: Some("c1".into()),
    }
}
pub fn settings() -> AppSettings {
    let mut s = AppSettings::initial(Some("ru-RU"));
    s.connections.push(connection());
    s.active_connection_id = Some("c1".into());
    s.consented_origins.push("https://api.deepseek.com".into());
    s
}
pub fn input() -> RunnerInput {
    RunnerInput {
        text: " hello ".into(),
        context: "".into(),
        app_name: "".into(),
        template_id: None,
        target_lang: None,
        limit: 5000,
    }
}
pub fn request() -> TextRequest {
    TextRequest {
        text: "hello".into(),
        context: "".into(),
        app_name: "".into(),
        source_lang: "auto".into(),
        target_lang: "ru".into(),
        pre_prompt: "be brief".into(),
        language_prompt: "".into(),
        model: model(),
    }
}
#[derive(Clone)]
pub struct RecordingTransport {
    pub requests: Arc<Mutex<Vec<(HttpRequest, Duration)>>>,
    pub response: Result<HttpResponse, TransportError>,
}
impl RecordingTransport {
    pub fn new(status: u16, body: Value) -> Self {
        Self {
            requests: Arc::default(),
            response: Ok(HttpResponse {
                status,
                headers: BTreeMap::new(),
                body: serde_json::to_vec(&body).unwrap(),
            }),
        }
    }
    pub fn completion() -> Self {
        Self::new(
            200,
            json!({"choices": [{"message": {"content": " translated "}}]}),
        )
    }
    pub fn models() -> Self {
        Self::new(
            200,
            json!({"data": [{"id": "deepseek-flash", "effort": {"supported_levels": ["high"]}}]}),
        )
    }
    pub fn from_fixture(value: &Value) -> Self {
        Self {
            requests: Arc::default(),
            response: Ok(HttpResponse {
                status: value["status"].as_u64().unwrap() as u16,
                headers: value["headers"]
                    .as_object()
                    .unwrap()
                    .iter()
                    .map(|(k, v)| (k.to_ascii_lowercase(), v.as_str().unwrap().into()))
                    .collect(),
                body: if let Some(s) = value["body"].as_str() {
                    s.as_bytes().to_vec()
                } else {
                    serde_json::to_vec(&value["body"]).unwrap()
                },
            }),
        }
    }
    pub fn request_value(&self, index: usize) -> Value {
        let requests = self.requests.lock().unwrap();
        let r = &requests[index].0;
        let mut v = json!({"method": r.method, "url": r.url, "headers": r.headers});
        if let Some(body) = &r.body {
            v["body"] = serde_json::from_slice(body).unwrap();
        }
        v
    }
}
impl HttpTransport for RecordingTransport {
    async fn send(
        &self,
        request: HttpRequest,
        timeout: Duration,
    ) -> Result<HttpResponse, TransportError> {
        self.requests.lock().unwrap().push((request, timeout));
        self.response.clone()
    }
}
pub fn fixture_client(input: &Value) -> (ProviderClient<RecordingTransport>, RecordingTransport) {
    let p = &input["provider"];
    let mut c = connection();
    c.preset = serde_json::from_value(p["preset"].clone()).unwrap();
    c.name = p["name"].as_str().unwrap().into();
    c.base_url = p["baseUrl"].as_str().unwrap().into();
    let t = RecordingTransport::from_fixture(&input["response"]);
    (
        ProviderClient::new(
            c,
            p["apiKey"].as_str().map(str::to_owned),
            t.clone(),
            fixed_now,
        ),
        t,
    )
}
