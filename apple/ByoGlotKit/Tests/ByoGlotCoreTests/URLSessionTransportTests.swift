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
        if url.path == "/trickle" {
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [:])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            for _ in 0..<30 {
                client?.urlProtocol(self, didLoad: Data(" ".utf8))
                Thread.sleep(forTimeInterval: 0.01)
            }
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        if url.path.hasPrefix("/start") {
            let target: URL
            switch url.host {
            case "cross.example": target = URL(string: "https://other.example/finish")!
            case "downgrade.example": target = URL(string: "http://downgrade.example/finish")!
            case "port.example": target = URL(string: "https://port.example:8443/finish")!
            default: target = URL(string: "https://\(url.host!)/finish")!
            }
            var redirected = request
            redirected.url = target
            let response = HTTPURLResponse(url: url, statusCode: 307, httpVersion: "HTTP/1.1", headerFields: ["Location": target.absoluteString])!
            client?.urlProtocol(self, wasRedirectedTo: redirected, redirectResponse: response)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data("redirect".utf8))
            client?.urlProtocolDidFinishLoading(self)
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

    @Test(arguments: ["cross.example", "downgrade.example", "port.example"])
    func refusesCrossOriginRedirects(_ host: String) async throws {
        let url = URL(string: "https://\(host)/start")!
        let response = try await transport().send(HTTPRequest(method: "POST", url: url, headers: ["Authorization": "Bearer fixture-key"], body: Data("selected text and context".utf8)), timeout: .seconds(5))
        #expect(response.status == 307)
        #expect(String(decoding: response.body, as: UTF8.self) == "redirect")
        let client = ProviderClient(connection: Connection(id: "c1", preset: .custom, name: "Redirect", baseUrl: url.absoluteString), secret: "fixture-key", transport: transport())
        do {
            _ = try await client.generate(prompt: "selected text", model: ModelRef(providerID: "custom", id: "model"))
            Issue.record("Expected refused redirect")
        } catch { #expect(error == BackendError(kind: .providerError, status: 307, detail: "HTTP 307")) }
    }

    @Test func tricklingResponseStillHasATotalDeadline() async throws {
        let start = ContinuousClock.now
        do {
            _ = try await transport().send(HTTPRequest(method: "GET", url: URL(string: "https://slow.example/trickle")!, headers: [:]), timeout: .milliseconds(120))
            Issue.record("Expected timeout")
        } catch { #expect((error as? URLError)?.code == .timedOut) }
        #expect(start.duration(to: .now) < .seconds(3))
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
