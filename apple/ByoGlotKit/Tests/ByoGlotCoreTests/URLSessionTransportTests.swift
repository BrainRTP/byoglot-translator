import Foundation
import Testing
@testable import ByoGlotCore

final class TransportStub: URLProtocol, Sendable {
    static let starts = AsyncStream<URLRequest>.makeStream()

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        if url.path == "/wait/chat/completions" {
            Self.starts.continuation.yield(request)
            return
        }
        if url.path == "/start" {
            let host = url.host == "cross.example" ? "other.example" : url.host!
            let target = URL(string: "https://\(host)/finish")!
            var redirected = request
            redirected.url = target
            let response = HTTPURLResponse(url: url, statusCode: 302, httpVersion: "HTTP/1.1", headerFields: ["Location": target.absoluteString])!
            client?.urlProtocol(self, wasRedirectedTo: redirected, redirectResponse: response)
            return
        }
        let body = Data((request.value(forHTTPHeaderField: "Authorization") ?? "missing").utf8)
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [:])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

struct URLSessionTransportTests {
    func transport() -> URLSessionTransport {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [TransportStub.self]
        return URLSessionTransport(configuration: configuration)
    }

    @Test func dropsAuthorizationOnCrossOriginRedirect() async throws {
        let response = try await transport().send(HTTPRequest(method: "GET", url: URL(string: "https://cross.example/start")!, headers: ["Authorization": "Bearer fixture-key"]), timeout: .seconds(5))
        #expect(String(decoding: response.body, as: UTF8.self) == "missing")
    }

    @Test func keepsAuthorizationOnSameOriginRedirect() async throws {
        let response = try await transport().send(HTTPRequest(method: "GET", url: URL(string: "https://same.example/start")!, headers: ["Authorization": "Bearer fixture-key"]), timeout: .seconds(5))
        #expect(String(decoding: response.body, as: UTF8.self) == "Bearer fixture-key")
    }

    @Test func cancellationSurfacesAsCancelled() async throws {
        let client = ProviderClient(connection: Connection(id: "c1", preset: .custom, name: "Wait", baseUrl: "https://cancel.example/wait"), secret: nil, transport: transport())
        var starts = TransportStub.starts.stream.makeAsyncIterator()
        let task = Task { try await client.generate(prompt: "hello", model: ModelRef(providerID: "custom", id: "model")) }
        let started = await starts.next()
        #expect(started?.url?.path == "/wait/chat/completions")
        task.cancel()
        do {
            _ = try await task.value
            Issue.record("Expected cancellation")
        } catch { #expect(error as? BackendError == BackendError(kind: .aborted)) }
    }
}
