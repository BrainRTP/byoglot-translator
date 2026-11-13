import ByoGlotCore
import ByoGlotStore
import Foundation
import Testing
@testable import ByoGlotBridge

private actor CannedTransport: HTTPTransport {
    var requests: [HTTPRequest] = []
    var timeouts: [Duration] = []
    let response: HTTPResponse
    let error: URLError.Code?

    init(status: Int = 200, headers: [String: String] = ["Content-Type": "application/json"], body: String = #"{"choices":[]}"#, error: URLError.Code? = nil) {
        response = HTTPResponse(status: status, headers: headers, body: Data(body.utf8))
        self.error = error
    }

    func send(_ request: HTTPRequest, timeout: Duration) async throws -> HTTPResponse {
        requests.append(request)
        timeouts.append(timeout)
        if let error { throw URLError(error) }
        return response
    }
}

private struct LockedStore: SecretStore {
    func set(_ secret: String, connectionId: String, origin: String) throws(SecretError) { throw .keychain(-1) }
    func secret(connectionId: String, origin: String) throws(SecretError) -> String? { throw .keychain(-1) }
    func has(connectionId: String) throws(SecretError) -> Bool { throw .keychain(-1) }
    func delete(connectionId: String) throws(SecretError) { throw .keychain(-1) }
}

private actor SuspendedTransport: HTTPTransport {
    let starts = AsyncStream<Int>.makeStream()
    let finishes = AsyncStream<Int>.makeStream()
    private var pending: [Int: CheckedContinuation<HTTPResponse, any Error>] = [:]
    private var count = 0

    func send(_ request: HTTPRequest, timeout: Duration) async throws -> HTTPResponse {
        count += 1
        let index = count
        defer { finishes.continuation.yield(index) }
        // Deliberately ignore cancellation to exercise late transport completions.
        return try await withCheckedThrowingContinuation { continuation in
            pending[index] = continuation
            starts.continuation.yield(index)
        }
    }

    func complete(_ index: Int, body: String = "done") {
        pending.removeValue(forKey: index)?.resume(returning: HTTPResponse(status: 200, headers: [:], body: Data(body.utf8)))
    }
}

private actor CancellableTransport: HTTPTransport {
    let starts = AsyncStream<Void>.makeStream()
    let cancellations = AsyncStream<Void>.makeStream()

    func send(_ request: HTTPRequest, timeout: Duration) async throws -> HTTPResponse {
        starts.continuation.yield(())
        do { try await Task.sleep(for: .seconds(30)) }
        catch {
            cancellations.continuation.yield(())
            throw error
        }
        return HTTPResponse(status: 200, headers: [:], body: Data())
    }
}

struct BridgeHandlerTests {
    private func boundStore() throws -> InMemorySecretStore {
        let store = InMemorySecretStore()
        try store.set("", connectionId: "c1", origin: "https://api.deepseek.com")
        return store
    }

    private func message(_ fields: [String: JSONValue]) throws -> Data {
        try JSONEncoder().encode(JSONValue.object(fields.merging(["v": .number(1)]) { old, _ in old }))
    }

    private func fetch(id: String = UUID().uuidString, url: String = "https://api.deepseek.com/chat/completions", headers: [String: String] = [:], timeout: Int = 180_000) throws -> Data {
        try message(["type": .string("fetch"), "id": .string(id), "connectionId": .string("c1"),
                     "method": .string("POST"), "url": .string(url), "body": .string("user text"),
                     "headers": .object(headers.mapValues(JSONValue.string)), "timeoutMs": .number(Double(timeout))])
    }

    private func reply(_ data: Data) throws -> JSONValue { try JSONDecoder().decode(JSONValue.self, from: data) }
    private func failure(_ name: String) -> JSONValue { .object(["ok": .bool(false), "error": .string(name)]) }

    @Test func everyExampleRequestDecodesAndEveryReplyShapeIsProduced() async throws {
        struct Envelope: Decodable {
            let version: Int
            let examples: [Example]
            struct Example: Decodable { let name: String; let request: JSONValue; let reply: JSONValue }
        }
        var root = URL(filePath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        let envelope = try JSONDecoder().decode(Envelope.self, from: Data(contentsOf: root.appending(path: "contracts/native-bridge-v1.json")))
        #expect(envelope.version == 1)
        #expect(envelope.examples.count == 13)
        for example in envelope.examples {
            let data = try JSONEncoder().encode(example.request)
            if example.name == "unsupported_version" {
                #expect(throws: BridgeError.unsupportedVersion) { try JSONDecoder().decode(BridgeRequest.self, from: data) }
            } else if example.name == "bad_request" {
                #expect(throws: BridgeError.badRequest) { try JSONDecoder().decode(BridgeRequest.self, from: data) }
            } else {
                _ = try JSONDecoder().decode(BridgeRequest.self, from: data)
            }
            let store = InMemorySecretStore()
            try store.set("fixture-key", connectionId: "c1", origin: "https://api.deepseek.com")
            let error: URLError.Code? = switch example.name {
            case "offline": .notConnectedToInternet
            case "timeout": .timedOut
            case "aborted": .cancelled
            default: nil
            }
            let bridge = BridgeHandler(secrets: example.name == "keychain" ? LockedStore() : store, transport: CannedTransport(error: error))
            #expect(try reply(await bridge.handle(data)) == example.reply, "Contract example: \(example.name)")
        }
    }

    @Test func fetchAddsTheStoredSecretAndDropsTheCallersAuthorization() async throws {
        let store = InMemorySecretStore()
        let transport = CannedTransport(status: 429, headers: ["Content-Type": "application/json", "Retry-After": "5", "Set-Cookie": "private"], body: "fixture-key")
        let bridge = BridgeHandler(secrets: store, transport: transport)
        let set = try message(["type": .string("setSecret"), "connectionId": .string("c1"), "origin": .string("https://API.DEEPSEEK.com:443"), "secret": .string("fixture-key")])
        #expect(try reply(await bridge.handle(set)) == .object(["ok": .bool(true)]))
        let result = await bridge.handle(try fetch(headers: [
            "Authorization": "caller", "aUtHoRiZaTiOn": "other", "content-type": "text/plain",
            "hOsT": "tenant.attacker.example", "Cookie": "session=private", "Connection": "keep-alive",
            "Content-Length": "999", "Transfer-Encoding": "chunked", "TE": "trailers", "Upgrade": "websocket",
            "Proxy-Authorization": "proxy", "pRoXy-Custom": "value", "Keep-Alive": "timeout=5", "Trailer": "Digest",
        ]))
        let request = try #require(await transport.requests.first)
        #expect(request.headers == ["authorization": "Bearer fixture-key", "content-type": "text/plain"])
        #expect(request.method == "POST")
        #expect(request.body == Data("user text".utf8))
        #expect(try reply(result) == .object(["ok": .bool(true), "status": .number(429), "headers": .object(["content-type": .string("application/json"), "retry-after": .string("5")]), "body": .string("[redacted]")]))
        #expect(!String(decoding: result, as: UTF8.self).contains("fixture-key"))
        #expect(try reply(await bridge.handle(message(["type": .string("hasSecret"), "connectionId": .string("c1")]))) == .object(["ok": .bool(true), "has": .bool(true)]))
        _ = await bridge.handle(try message(["type": .string("deleteSecret"), "connectionId": .string("c1")]))
        let hasSecret = try store.has(connectionId: "c1")
        #expect(!hasSecret)
    }

    @Test func fetchRefusesAnotherOrigin() async throws {
        let store = InMemorySecretStore()
        try store.set("fixture-key", connectionId: "c1", origin: "https://api.deepseek.com")
        let transport = CannedTransport()
        let bridge = BridgeHandler(secrets: store, transport: transport)
        #expect(try reply(await bridge.handle(fetch(url: "https://evil.example/x"))) == failure("origin_mismatch"))
        #expect(await transport.requests.isEmpty)
    }

    @Test func fetchWithoutASecretSendsNoAuthorization() async throws {
        let transport = CannedTransport()
        let bridge = BridgeHandler(secrets: InMemorySecretStore(), transport: transport)
        let url = "http://localhost:11434/v1"
        for unbound in [url, "http://192.168.1.1/admin/config", "https://api.deepseek.com/chat/completions"] {
            #expect(try reply(await bridge.handle(fetch(url: unbound))) == failure("origin_mismatch"))
        }
        #expect(await transport.requests.isEmpty)
        let set = try message(["type": .string("setSecret"), "connectionId": .string("c1"), "origin": .string("http://localhost:11434"), "secret": .string("")])
        #expect(try reply(await bridge.handle(set)) == .object(["ok": .bool(true)]))
        let result = await bridge.handle(try fetch(url: url, headers: ["Authorization": "caller", "authorization": "other", "Proxy-Authorization": "proxy"]))
        #expect(try JSONDecoder().decode(BridgeReply.self, from: result).ok)
        #expect(await transport.requests.count == 1)
        #expect(await transport.requests.first?.headers.isEmpty == true)
        #expect(try reply(await bridge.handle(fetch(url: "http://localhost:11435/v1"))) == failure("origin_mismatch"))
        #expect(await transport.requests.count == 1)
    }

    @Test func nonHttpUrlIsBadRequest() async throws {
        let transport = CannedTransport()
        let bridge = BridgeHandler(secrets: InMemorySecretStore(), transport: transport)
        #expect(try reply(await bridge.handle(fetch(url: "file:///etc/passwd"))) == failure("bad_request"))
        #expect(await transport.requests.isEmpty)
    }

    @Test func cancelAbortsTheRunningFetch() async throws {
        let transport = CancellableTransport()
        let bridge = BridgeHandler(secrets: try boundStore(), transport: transport)
        let otherHandler = BridgeHandler(secrets: InMemorySecretStore(), transport: CannedTransport())
        let id = UUID().uuidString
        var starts = transport.starts.stream.makeAsyncIterator()
        var cancellations = transport.cancellations.stream.makeAsyncIterator()
        let request = try fetch(id: id)
        let running = Task { await bridge.handle(request) }
        _ = await starts.next()
        let cancel = try message(["type": .string("cancel"), "id": .string(id)])
        #expect(try reply(await otherHandler.handle(cancel)) == .object(["ok": .bool(true)]))
        #expect(try reply(await running.value) == failure("aborted"))
        #expect(await cancellations.next() != nil)
    }

    @Test func timeoutIsReported() async throws {
        let bridge = BridgeHandler(secrets: try boundStore(), transport: CannedTransport(error: .timedOut))
        #expect(try reply(await bridge.handle(fetch())) == failure("timeout"))
    }

    @Test func garbageInputIsBadRequest() async throws {
        let bridge = BridgeHandler(secrets: InMemorySecretStore(), transport: CannedTransport())
        for text in ["not JSON", "[]", "{}", #"{"v":true,"type":"ping"}"#, #"{"v":1,"type":"unknown"}"#, #"{"v":1,"type":"setSecret"}"#, #"{"v":1,"type":"hasSecret","connectionId":""}"#, #"{"v":1,"type":"setSecret","connectionId":"c1","origin":"file:///tmp","secret":"x"}"#] {
            #expect(try reply(await bridge.handle(Data(text.utf8))) == failure("bad_request"))
        }
        #expect(try reply(await bridge.handle(message(["v": .number(2), "type": .string("ping")]))) == failure("unsupported_version"))
        #expect(try reply(await bridge.handle(fetch(timeout: 0))) == failure("bad_request"))
    }

    @Test func refusesPublicHTTPBeforeCallingTheTransportAndAllowsLAN() async throws {
        let transport = CannedTransport()
        let store = InMemorySecretStore()
        let bridge = BridgeHandler(secrets: store, transport: transport)
        for url in ["http://models.example.com/x", "http://8.8.8.8/x", "https://user:pass@api.deepseek.com/x"] {
            #expect(try reply(await bridge.handle(fetch(url: url))) == failure("bad_request"))
        }
        #expect(await transport.requests.isEmpty)
        for url in ["http://localhost:11434/v1", "http://127.0.0.1:4096/", "http://192.168.1.5/v1", "http://[::1]/"] {
            try store.set("", connectionId: "c1", origin: #require(originOf(url)))
            _ = await bridge.handle(try fetch(url: url))
        }
        #expect(await transport.requests.count == 4)
    }

    @Test func totalDeadlineCancelsAndLateReplyCannotCompleteAReusedID() async throws {
        let transport = SuspendedTransport()
        let bridge = BridgeHandler(secrets: try boundStore(), transport: transport)
        var starts = transport.starts.stream.makeAsyncIterator()
        var finishes = transport.finishes.stream.makeAsyncIterator()
        let id = UUID().uuidString
        let initial = try fetch(id: id, timeout: 50)
        let first = Task { await bridge.handle(initial) }
        #expect(await starts.next() == 1)
        #expect(try reply(await first.value) == failure("timeout"))
        let replacement = try fetch(id: id)
        let second = Task { await bridge.handle(replacement) }
        #expect(await starts.next() == 2)
        await transport.complete(1, body: "stale")
        #expect(await finishes.next() == 1)
        await transport.complete(2, body: "current")
        let response = try JSONDecoder().decode(BridgeReply.self, from: await second.value)
        #expect(response.ok)
        #expect(response.body == "current")
    }

    @Test func reusedIDAbortsTheOldFetchAndCapsTheDeadline() async throws {
        let transport = SuspendedTransport()
        let bridge = BridgeHandler(secrets: try boundStore(), transport: transport)
        var starts = transport.starts.stream.makeAsyncIterator()
        let id = UUID().uuidString
        let data = try fetch(id: id)
        let first = Task { await bridge.handle(data) }
        _ = await starts.next()
        let second = Task { await bridge.handle(data) }
        _ = await starts.next()
        #expect(try reply(await first.value) == failure("aborted"))
        _ = await bridge.handle(try message(["type": .string("cancel"), "id": .string(id)]))
        #expect(try reply(await second.value) == failure("aborted"))
        await transport.complete(1)
        await transport.complete(2)
        let recording = CannedTransport()
        _ = await BridgeHandler(secrets: try boundStore(), transport: recording).handle(try fetch(timeout: 999_999))
        #expect(try #require(await recording.timeouts.first) <= .seconds(180))
    }
}
