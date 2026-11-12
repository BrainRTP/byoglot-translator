use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fmt, future::Future, sync::Arc, time::Duration};

#[derive(Clone, PartialEq, Serialize, Deserialize)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub body: Option<Vec<u8>>,
}
impl fmt::Debug for HttpRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let headers: BTreeMap<_, _> = self
            .headers
            .iter()
            .map(|(k, v)| {
                (
                    k,
                    if k.eq_ignore_ascii_case("authorization") {
                        "[redacted]"
                    } else {
                        v.as_str()
                    },
                )
            })
            .collect();
        f.debug_struct("HttpRequest")
            .field("method", &self.method)
            .field("url", &self.url)
            .field("headers", &headers)
            .field("body_bytes", &self.body.as_ref().map(Vec::len))
            .finish()
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub enum TransportError {
    Offline,
    Timeout,
    Cancelled,
}
pub trait HttpTransport: Sync {
    fn send(
        &self,
        request: HttpRequest,
        timeout: Duration,
    ) -> impl Future<Output = Result<HttpResponse, TransportError>> + Send;
}
impl<T: HttpTransport + Send> HttpTransport for Arc<T> {
    fn send(
        &self,
        request: HttpRequest,
        timeout: Duration,
    ) -> impl Future<Output = Result<HttpResponse, TransportError>> + Send {
        (**self).send(request, timeout)
    }
}
