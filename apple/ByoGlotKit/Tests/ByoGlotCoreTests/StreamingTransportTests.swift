import Foundation
import Synchronization
import Testing
@testable import ByoGlotCore

private final class StreamingStub: URLProtocol, @unchecked Sendable {
    static let starts = AsyncStream<String>.makeStream()
    static let stops = AsyncStream<String>.makeStream()
    private let stopped = Mutex(false)

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let url = request.url!
        if url.path.hasPrefix("/oversize") {
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: url.path == "/oversize" ? ["Content-Length": "\(providerResponseSizeLimit + 1)"] : [:])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(repeating: 32, count: providerResponseSizeLimit + 1))
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["content-type": "text/event-stream"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n".utf8))
        Self.starts.continuation.yield(url.path)
        if url.path == "/done/chat/completions" {
            client?.urlProtocol(self, didLoad: Data("data: [DONE]\n\n".utf8))
        }
        if url.path == "/trickle" {
            DispatchQueue.global().async {
                while !self.stopped.withLock({ $0 }) {
                    Thread.sleep(forTimeInterval: 0.01)
                    if self.stopped.withLock({ $0 }) { break }
                    self.client?.urlProtocol(self, didLoad: Data(": heartbeat\n\n".utf8))
                }
            }
        }
    }
    override func stopLoading() {
        stopped.withLock { $0 = true }
        Self.stops.continuation.yield(request.url!.path)
    }
}

@Suite(.serialized) struct StreamingTransportTests {
    private func transport() -> URLSessionTransport {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StreamingStub.self]
        return URLSessionTransport(configuration: configuration)
    }

    @Test func cancellingConsumerCancelsTheURLSessionRequest() async throws {
        let client = ProviderClient(connection: Connection(id: "c", preset: .custom, name: "Test", baseUrl: "https://stream.example/wait"), secret: nil, transport: transport())
        let task = Task {
            for try await _ in client.stream(prompt: "private text", model: ModelRef(providerID: "custom", id: "m")) {}
        }
        var starts = StreamingStub.starts.stream.makeAsyncIterator()
        while let path = await starts.next() { if path == "/wait/chat/completions" { break } }
        task.cancel()
        do { try await task.value }
        catch { #expect(error as? BackendError == BackendError(kind: .aborted)) }
        var stops = StreamingStub.stops.stream.makeAsyncIterator()
        while let path = await stops.next() { if path == "/wait/chat/completions" { break } }
    }

    @Test func doneMarkerClosesAnOtherwiseOpenHTTPStream() async throws {
        let client = ProviderClient(connection: Connection(id: "c", preset: .custom, name: "Test", baseUrl: "https://stream.example/done"), secret: nil, transport: transport())
        var received = ""
        for try await chunk in client.stream(prompt: "private text", model: ModelRef(providerID: "custom", id: "m")) { received += chunk.text }
        #expect(received == "partial")
        var stops = StreamingStub.stops.stream.makeAsyncIterator()
        while let path = await stops.next() { if path == "/done/chat/completions" { break } }
    }

    @Test func tricklingStreamStillHitsTotalDeadline() async throws {
        let request = HTTPRequest(method: "GET", url: URL(string: "https://stream.example/trickle")!, headers: [:])
        let start = ContinuousClock.now
        do {
            for try await _ in transport().stream(request, timeout: .milliseconds(100)) {}
            Issue.record("Expected deadline")
        } catch { #expect((error as? URLError)?.code == .timedOut) }
        #expect(start.duration(to: .now) < .seconds(3))
    }

    @Test(arguments: ["/oversize", "/oversize-unknown"])
    func boundsStreamingResponseSize(_ path: String) async throws {
        let request = HTTPRequest(method: "GET", url: URL(string: "https://stream.example" + path)!, headers: [:])
        do {
            for try await _ in transport().stream(request, timeout: .seconds(10)) {}
            Issue.record("Expected size bound")
        } catch { #expect((error as? URLError)?.code == .dataLengthExceedsMaximum) }
    }

    @Test(arguments: ["cross.example", "downgrade.example", "port.example"])
    func refusesCrossOriginStreamingRedirects(_ host: String) async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [TransportStub.self]
        let transport = URLSessionTransport(configuration: configuration)
        let client = ProviderClient(connection: Connection(id: "c", preset: .custom, name: "Redirect", baseUrl: "https://\(host)/start"), secret: "fixture-key", transport: transport)
        do {
            for try await _ in client.stream(prompt: "private text", model: ModelRef(providerID: "custom", id: "m")) {}
            Issue.record("Expected refused redirect")
        } catch { #expect(error as? BackendError == BackendError(kind: .providerError, status: 307)) }
    }
}
