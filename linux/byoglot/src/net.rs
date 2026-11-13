use byoglot_core::{HttpRequest, HttpResponse, HttpTransport, TransportError, is_local_host};
use reqwest::{Client, Method, Url, header, redirect};
use std::{collections::BTreeMap, time::Duration};
use tokio::{runtime::Handle, task::JoinHandle};

const MAX_BODY: usize = 8 * 1024 * 1024;

#[derive(Clone)]
pub struct ReqwestTransport {
    client: Client,
    runtime: Handle,
}

pub(crate) struct AbortOnDrop<T>(pub JoinHandle<T>);
impl<T> Drop for AbortOnDrop<T> {
    fn drop(&mut self) {
        self.0.abort();
    }
}

impl ReqwestTransport {
    pub fn new(runtime: Handle) -> Result<Self, TransportError> {
        let client = Client::builder()
            .redirect(redirect::Policy::none())
            .referer(false)
            .build()
            .map_err(|_| TransportError::Offline)?;
        Ok(Self { client, runtime })
    }
}

impl HttpTransport for ReqwestTransport {
    async fn send(
        &self,
        request: HttpRequest,
        timeout: Duration,
    ) -> Result<HttpResponse, TransportError> {
        let client = self.client.clone();
        let mut task = AbortOnDrop(self.runtime.spawn(async move {
            tokio::time::timeout(
                timeout.min(Duration::from_secs(180)),
                perform(client, request),
            )
            .await
            .map_err(|_| TransportError::Timeout)?
        }));
        (&mut task.0).await.map_err(|_| TransportError::Cancelled)?
    }
}

fn permitted(url: &Url) -> bool {
    url.username().is_empty()
        && url.password().is_none()
        && (url.scheme() == "https"
            || (url.scheme() == "http" && url.host_str().is_some_and(is_local_host)))
}

async fn perform(client: Client, request: HttpRequest) -> Result<HttpResponse, TransportError> {
    let mut url = Url::parse(&request.url).map_err(|_| TransportError::Offline)?;
    if !permitted(&url) {
        return Err(TransportError::Offline);
    }
    let origin = url.origin();
    let mut method =
        Method::from_bytes(request.method.as_bytes()).map_err(|_| TransportError::Offline)?;
    let mut body = request.body;
    for redirect_count in 0..=5 {
        let mut builder = client.request(method.clone(), url.clone());
        for (name, value) in &request.headers {
            let name = header::HeaderName::from_bytes(name.as_bytes())
                .map_err(|_| TransportError::Offline)?;
            let mut value =
                header::HeaderValue::from_str(value).map_err(|_| TransportError::Offline)?;
            value.set_sensitive(true);
            if body.is_some() || name != header::CONTENT_TYPE {
                builder = builder.header(name, value);
            }
        }
        if let Some(body) = &body {
            builder = builder.body(body.clone());
        }
        let mut response = builder.send().await.map_err(map_error)?;
        let status = response.status();
        if status.is_redirection()
            && redirect_count < 5
            && let Some(next) = response
                .headers()
                .get(header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| url.join(v).ok())
            && next.origin() == origin
            && permitted(&next)
        {
            if status == 303 || ((status == 301 || status == 302) && method == Method::POST) {
                method = Method::GET;
                body = None;
            }
            url = next;
            continue;
        }
        let headers: BTreeMap<_, _> = response
            .headers()
            .iter()
            .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.as_str().into(), v.into())))
            .collect();
        if response
            .content_length()
            .is_some_and(|n| n > MAX_BODY as u64)
        {
            return Err(TransportError::BadResponse);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(map_error)? {
            if bytes.len().saturating_add(chunk.len()) > MAX_BODY {
                return Err(TransportError::BadResponse);
            }
            bytes.extend_from_slice(&chunk);
        }
        return Ok(HttpResponse {
            status: status.as_u16(),
            headers,
            body: bytes,
        });
    }
    Err(TransportError::Offline)
}

fn map_error(error: reqwest::Error) -> TransportError {
    if error.is_timeout() {
        TransportError::Timeout
    } else {
        TransportError::Offline
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };

    #[tokio::test]
    async fn oversized_declared_and_streamed_bodies_are_bad_responses() {
        for chunked in [false, true] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}", listener.local_addr().unwrap());
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                let mut request = [0; 4096];
                socket.read(&mut request).unwrap();
                if chunked {
                    let body = vec![b'x'; MAX_BODY + 1];
                    let _ = write!(
                        socket,
                        "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n",
                        body.len()
                    );
                    let _ = socket.write_all(&body);
                    let _ = socket.write_all(b"\r\n0\r\n\r\n");
                } else {
                    let _ = write!(
                        socket,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n",
                        MAX_BODY + 1
                    );
                }
            });
            let transport = ReqwestTransport::new(Handle::current()).unwrap();
            let request = HttpRequest {
                method: "GET".into(),
                url,
                headers: BTreeMap::new(),
                body: None,
            };
            assert_eq!(
                transport.send(request, Duration::from_secs(3)).await,
                Err(TransportError::BadResponse)
            );
            server.join().unwrap();
        }
    }
}
