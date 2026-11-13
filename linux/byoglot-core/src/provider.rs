use crate::{
    BackendError, Connection, ErrorKind, HttpRequest, HttpResponse, HttpTransport, ModelInfo,
    ModelRef, TransportError, contracts, effort_params, effort_variants,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    fmt,
    future::Future,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub trait TextGenerator: Sync {
    fn generate(
        &self,
        prompt: &str,
        model: &ModelRef,
    ) -> impl Future<Output = Result<String, BackendError>> + Send;
}

pub struct ProviderClient<T: HttpTransport> {
    connection: Connection,
    secret: Option<String>,
    transport: T,
    now: fn() -> SystemTime,
}
impl<T: HttpTransport> fmt::Debug for ProviderClient<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ProviderClient")
            .field("connection", &self.connection)
            .field("secret", &"[redacted]")
            .finish_non_exhaustive()
    }
}
impl<T: HttpTransport> ProviderClient<T> {
    pub fn new(
        connection: Connection,
        secret: Option<String>,
        transport: T,
        now: fn() -> SystemTime,
    ) -> Self {
        Self {
            connection,
            secret,
            transport,
            now,
        }
    }
    async fn call<D: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        body: Option<Value>,
        timeout: Duration,
    ) -> Result<D, BackendError> {
        if crate::effort::permitted_endpoint(&self.connection.base_url).is_none() {
            return Err(incompatible("invalid or insecure base URL"));
        }
        let mut headers = std::collections::BTreeMap::new();
        if let Some(secret) = self.secret.as_deref().filter(|s| !s.is_empty()) {
            headers.insert("authorization".into(), format!("Bearer {secret}"));
        }
        if body.is_some() {
            headers.insert("content-type".into(), "application/json".into());
        }
        let response = self
            .transport
            .send(
                HttpRequest {
                    method: if body.is_some() { "POST" } else { "GET" }.into(),
                    url: format!("{}{path}", self.connection.base_url.trim_end_matches('/')),
                    headers,
                    body: body.map(|v| serde_json::to_vec(&v).unwrap()),
                },
                timeout,
            )
            .await
            .map_err(|error| {
                BackendError::new(match error {
                    TransportError::Cancelled => ErrorKind::Aborted,
                    TransportError::BadResponse => ErrorKind::BadResponse,
                    TransportError::Offline | TransportError::Timeout => ErrorKind::Offline,
                })
            })?;
        if !(200..300).contains(&response.status) {
            let mut error = failure(response, (self.now)());
            if let (Some(detail), Some(secret)) = (
                &mut error.detail,
                self.secret.as_deref().filter(|s| !s.is_empty()),
            ) {
                *detail = detail.replace(secret, "[redacted]");
            }
            return Err(error);
        }
        let value: Value = serde_json::from_slice(&response.body)
            .map_err(|_| incompatible("response is not JSON"))?;
        serde_json::from_value(value).map_err(|_| incompatible("unexpected response shape"))
    }
    pub async fn list_models(&self) -> Result<Vec<ModelInfo>, BackendError> {
        let raw: ModelList = self.call("/models", None, Duration::from_secs(30)).await?;
        Ok(raw
            .data
            .into_iter()
            .map(|raw| ModelInfo {
                provider_id: self.connection.preset.wire().into(),
                name: raw.name.unwrap_or_else(|| raw.id.clone()),
                variants: effort_variants(
                    self.connection.preset,
                    raw.effort
                        .as_ref()
                        .and_then(|e| e.supported_levels.as_deref()),
                    raw.supported_parameters.as_deref(),
                ),
                id: raw.id,
                context_limit: raw.context_window.or(raw.context_length).unwrap_or(0.0),
                output_limit: raw.max_output_tokens.unwrap_or(0.0),
            })
            .collect())
    }
    pub async fn default_model(&self) -> Result<Option<ModelInfo>, BackendError> {
        let models = self.list_models().await?;
        if self.connection.preset == crate::ProviderPreset::Deepseek {
            Ok(models.into_iter().find(|m| m.id == "deepseek-flash"))
        } else {
            Ok(models.into_iter().next())
        }
    }
}
impl<T: HttpTransport> TextGenerator for ProviderClient<T> {
    async fn generate(&self, prompt: &str, model: &ModelRef) -> Result<String, BackendError> {
        let mut body = json!({"model": model.id, "messages": [{"role": "user", "content": prompt}], "stream": false});
        body.as_object_mut().unwrap().extend(effort_params(
            self.connection.preset,
            model.variant.as_deref(),
        ));
        let raw: Chat = self
            .call(
                "/chat/completions",
                Some(body),
                Duration::from_millis(contracts::limits().generate_timeout_ms),
            )
            .await?;
        raw.choices
            .into_iter()
            .next()
            .and_then(|choice| choice.message.content)
            .filter(|content| !content.is_empty())
            .ok_or_else(|| {
                let mut e = BackendError::new(ErrorKind::BadResponse);
                e.detail = Some("empty completion".into());
                e
            })
    }
}
fn incompatible(detail: &str) -> BackendError {
    let mut e = BackendError::new(ErrorKind::Incompatible);
    e.detail = Some(detail.into());
    e
}
#[derive(Deserialize)]
struct ModelList {
    data: Vec<RawModel>,
}
#[derive(Deserialize)]
struct RawModel {
    id: String,
    name: Option<String>,
    context_window: Option<f64>,
    context_length: Option<f64>,
    max_output_tokens: Option<f64>,
    effort: Option<Effort>,
    supported_parameters: Option<Vec<String>>,
}
#[derive(Deserialize)]
struct Effort {
    supported_levels: Option<Vec<String>>,
}
#[derive(Deserialize)]
struct Chat {
    choices: Vec<Choice>,
}
#[derive(Deserialize)]
struct Choice {
    message: Message,
}
#[derive(Deserialize)]
struct Message {
    content: Option<String>,
}
fn failure(response: HttpResponse, now: SystemTime) -> BackendError {
    let message = serde_json::from_slice::<Value>(&response.body)
        .ok()
        .and_then(|v| v.get("error")?.get("message")?.as_str().map(str::to_owned));
    let status = response.status;
    if status == 404 {
        return incompatible("HTTP 404");
    }
    let mut e = BackendError::new(match status {
        401 | 403 => ErrorKind::ProviderAuth,
        429 => ErrorKind::RateLimit,
        _ => ErrorKind::ProviderError,
    });
    e.status = Some(status);
    e.detail = match status {
        402 => Some("insufficient balance".into()),
        401 | 403 | 429 => message,
        _ => Some(message.unwrap_or_else(|| format!("HTTP {status}"))),
    };
    if status == 429 {
        e.retry_after_ms = response
            .headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("retry-after"))
            .and_then(|(_, v)| retry_after(v, now));
    }
    e
}
fn retry_after(value: &str, now: SystemTime) -> Option<f64> {
    let value = value.trim();
    let mut pieces = value.split('.');
    let integer = pieces.next()?;
    let fraction = pieces.next();
    if !integer.is_empty()
        && integer.bytes().all(|b| b.is_ascii_digit())
        && fraction.is_none_or(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
        && pieces.next().is_none()
    {
        let milliseconds = (value.parse::<f64>().ok()? * 1000.0).round();
        return Some(milliseconds.min(86_400_000.0));
    }
    if value.len() != 29
        || value.get(3..5)? != ", "
        || value.get(7..8)? != " "
        || value.get(11..12)? != " "
        || value.get(16..17)? != " "
        || value.get(19..20)? != ":"
        || value.get(22..23)? != ":"
        || value.get(25..)? != " GMT"
    {
        return None;
    }
    let weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        .iter()
        .position(|v| Some(*v) == value.get(..3))? as i64;
    let month = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]
    .iter()
    .position(|v| Some(*v) == value.get(8..11))? as u32
        + 1;
    let year = digits(value.get(12..16)?)? as i32;
    let day = digits(value.get(5..7)?)?;
    let hour = digits(value.get(17..19)?)?;
    let minute = digits(value.get(20..22)?)?;
    let second = digits(value.get(23..25)?)?;
    let days = calendar_days(year, month, day)?;
    if (days + 4).rem_euclid(7) != weekday || hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    let timestamp = (days * 86400 + i64::from(hour * 3600 + minute * 60 + second)) * 1000;
    let now = match now.duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_millis() as i128,
        Err(e) => -(e.duration().as_millis() as i128),
    };
    Some((i128::from(timestamp) - now).clamp(0, 86_400_000) as f64)
}
pub(crate) fn digits(value: &str) -> Option<u32> {
    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
        None
    } else {
        value.parse().ok()
    }
}
pub(crate) fn calendar_days(year: i32, month: u32, day: u32) -> Option<i64> {
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        _ => return None,
    };
    if day == 0 || day > max_day {
        return None;
    }
    let y = i64::from(year) - i64::from(month <= 2);
    let era = y.div_euclid(400);
    let year_of_era = y - era * 400;
    let month = i64::from(month) + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * month + 2) / 5 + i64::from(day) - 1;
    Some(
        era * 146097 + year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year
            - 719468,
    )
}
