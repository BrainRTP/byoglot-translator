use byoglot::net::ReqwestTransport;
use byoglot_core::{HttpRequest, HttpTransport, TransportError};
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    net::TcpListener,
    sync::mpsc,
    thread,
    time::Duration,
};

fn request(url: String) -> HttpRequest {
    HttpRequest {
        method: "GET".into(),
        url,
        headers: BTreeMap::from([("authorization".into(), "Bearer secret".into())]),
        body: None,
    }
}
fn server(response: String) -> (String, mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut bytes = [0; 8192];
        let n = socket.read(&mut bytes).unwrap();
        let _ = tx.send(String::from_utf8_lossy(&bytes[..n]).into_owned());
        let _ = socket.write_all(response.as_bytes());
    });
    (url, rx)
}
fn transport() -> ReqwestTransport {
    ReqwestTransport::new(tokio::runtime::Handle::current()).unwrap()
}
#[tokio::test]
async fn returns_status_headers_and_body() {
    let (url, _) =
        server("HTTP/1.1 201 Created\r\nContent-Length: 2\r\nX-Test: yes\r\n\r\nok".into());
    let response = transport()
        .send(request(url), Duration::from_secs(2))
        .await
        .unwrap();
    assert_eq!(response.status, 201);
    assert_eq!(response.headers["x-test"], "yes");
    assert_eq!(response.body, b"ok");
}
#[tokio::test]
async fn refuses_cleartext_to_a_public_host() {
    assert_eq!(
        transport()
            .send(request("http://example.com".into()), Duration::from_secs(1))
            .await,
        Err(TransportError::Offline)
    );
}
#[tokio::test]
async fn drops_authorization_on_a_cross_origin_redirect() {
    let target = TcpListener::bind("127.0.0.1:0").unwrap();
    target.set_nonblocking(true).unwrap();
    let (url, _) = server(format!(
        "HTTP/1.1 307 Temporary Redirect\r\nLocation: http://{}\r\nContent-Length: 0\r\n\r\n",
        target.local_addr().unwrap()
    ));
    let response = transport()
        .send(request(url), Duration::from_secs(2))
        .await
        .unwrap();
    assert_eq!(response.status, 307);
    assert_eq!(
        target.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
}
#[tokio::test]
async fn keeps_authorization_on_a_same_origin_redirect() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = thread::spawn(move || {
        for index in 0..2 {
            let (mut socket, _) = listener.accept().unwrap();
            let mut bytes = [0; 4096];
            let n = socket.read(&mut bytes).unwrap();
            let text = String::from_utf8_lossy(&bytes[..n]);
            assert!(text.contains("authorization: Bearer secret"));
            socket.write_all(if index == 0 { b"HTTP/1.1 307 Temporary Redirect\r\nLocation: /next\r\nContent-Length: 0\r\nConnection: close\r\n\r\n" } else { b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok" }).unwrap();
        }
    });
    assert_eq!(
        transport()
            .send(request(url), Duration::from_secs(2))
            .await
            .unwrap()
            .body,
        b"ok"
    );
    task.join().unwrap();
}
#[tokio::test]
async fn dropping_the_future_closes_the_connection() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let (tx, rx) = tokio::sync::oneshot::channel();
    let task = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut bytes = [0; 4096];
        assert!(socket.read(&mut bytes).unwrap() > 0);
        tx.send(()).unwrap();
        match socket.read(&mut bytes) {
            Ok(0) => (),
            Err(e) if e.kind() == std::io::ErrorKind::ConnectionReset => (),
            other => panic!("connection was not closed: {other:?}"),
        }
    });
    let transport = transport();
    let mut future = Box::pin(transport.send(request(url), Duration::from_secs(10)));
    tokio::select! { _ = &mut future => panic!("request finished"), _ = rx => () }
    drop(future);
    tokio::task::spawn_blocking(move || task.join().unwrap())
        .await
        .unwrap();
}
#[tokio::test]
async fn times_out() {
    // Keep a connection open without a response to exercise the total deadline.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = thread::spawn(move || {
        let (_socket, _) = listener.accept().unwrap();
        thread::sleep(Duration::from_millis(150));
    });
    assert_eq!(
        transport()
            .send(request(url), Duration::from_millis(40))
            .await,
        Err(TransportError::Timeout)
    );
    task.join().unwrap();
}
