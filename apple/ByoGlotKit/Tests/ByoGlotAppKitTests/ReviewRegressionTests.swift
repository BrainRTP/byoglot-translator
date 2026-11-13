import ByoGlotCore
import ByoGlotStore
import Foundation
import Synchronization
import Testing
@testable import ByoGlotAppKit

private actor GatedModelsTransport: HTTPTransport {
    let starts = AsyncStream<Bool>.makeStream()
    var requests: [HTTPRequest] = []
    private var gate: CheckedContinuation<Void, Never>?

    func send(_ request: HTTPRequest, timeout: Duration) async throws -> HTTPResponse {
        requests.append(request)
        if request.url.host == "first.example" {
            await withCheckedContinuation { continuation in
                gate = continuation
                starts.continuation.yield(true)
            }
        }
        return HTTPResponse(status: 200, headers: [:], body: Data(#"{"data":[{"id":"model"}]}"#.utf8))
    }

    func release() { gate?.resume(); gate = nil }
}

private struct HookedSecrets: SecretStore {
    let base: InMemorySecretStore
    let onSet: @Sendable (String) -> Void
    func set(_ secret: String, connectionId: String, origin: String) throws(SecretError) {
        try base.set(secret, connectionId: connectionId, origin: origin)
        onSet(secret)
    }
    func secret(connectionId: String, origin: String) throws(SecretError) -> String? { try base.secret(connectionId: connectionId, origin: origin) }
    func has(connectionId: String) throws(SecretError) -> Bool { try base.has(connectionId: connectionId) }
    func delete(connectionId: String) throws(SecretError) { try base.delete(connectionId: connectionId) }
}

struct ReviewRegressionTests {
    @Test(.timeLimit(.minutes(1))) func interleavedSavesAreSerializedAndCommitSurvivesCallerCancellation() async throws {
        let f = AppFixture()
        try await f.connect()
        let transport = GatedModelsTransport()
        let firstTask = Mutex<Task<Connection, any Error>?>(nil)
        let secrets = HookedSecrets(base: f.secrets) { secret in
            if secret == "first-key" { firstTask.withLock { $0?.cancel() } }
        }
        let editor = ConnectionEditor(settings: f.settings, secrets: secrets, transport: transport, modelCapabilities: f.capabilities, urlPolicy: .allowLocalHTTP)
        let first = Task { try await editor.save(ConnectionDraft(id: "c1", preset: .custom, name: "First", baseUrl: "https://first.example/v1", apiKey: "first-key"), consent: true) }
        firstTask.withLock { $0 = first }
        var started = transport.starts.stream.makeAsyncIterator()
        #expect(await started.next() == true)
        let second = Task { try await editor.save(ConnectionDraft(id: "c1", preset: .custom, name: "Second", baseUrl: "https://second.example/v1", apiKey: "second-key"), consent: true) }
        while await editor.pendingMutations == 0 { await Task.yield() }
        #expect(await transport.requests.count == 1)
        await transport.release()
        #expect(try await first.value.baseUrl == "https://first.example/v1")
        #expect(try await second.value.baseUrl == "https://second.example/v1")
        let state = try await f.settings.read()
        #expect(state.connections.first?.baseUrl == "https://second.example/v1")
        #expect(try f.secrets.secret(connectionId: "c1", origin: "https://second.example") == "second-key")
        #expect(await transport.requests.map { $0.url.host } == ["first.example", "second.example"])
    }

    @Test func settingsWriteFailureRestoresTheOldKeyAndLeavesSettingsUnchanged() async throws {
        let f = AppFixture()
        try await f.connect()
        let before = try Data(contentsOf: f.directory.appending(path: "settings.json"))
        let lock = f.directory.appending(path: "settings.lock")
        let secrets = HookedSecrets(base: f.secrets) { secret in
            if secret == "new-key" {
                try? FileManager.default.removeItem(at: lock)
                try? FileManager.default.createDirectory(at: lock, withIntermediateDirectories: true)
            }
        }
        let editor = ConnectionEditor(settings: f.settings, secrets: secrets, transport: f.transport, urlPolicy: .allowLocalHTTP)
        await #expect(throws: RunnerError.backend(BackendError(kind: .providerError))) {
            try await editor.save(ConnectionDraft(id: "c1", preset: .custom, name: "New", baseUrl: "https://new.example/v1", apiKey: "new-key"), consent: true)
        }
        #expect(try Data(contentsOf: f.directory.appending(path: "settings.json")) == before)
        #expect(try f.secrets.secret(connectionId: "c1", origin: "https://provider.example") == "fixture-key")
    }

    @Test func removalActivatesTheNextModelConnectionAndExistingConnectionsNeverReportNoConnection() async throws {
        let f = AppFixture()
        try await f.connect()
        let model = ModelRef(providerID: "custom", id: "next", variant: "none", connectionId: "next")
        _ = try await f.settings.update { state in
            state.connections.append(Connection(id: "empty", preset: .custom, name: "Empty", baseUrl: "http://localhost"))
            state.connections.append(Connection(id: "next", preset: .custom, name: "Next", baseUrl: "http://localhost", selectionModel: model))
            state.externalModel = model
        }
        try await f.editor.remove(id: "c1")
        #expect(try await f.settings.read().activeConnectionId == "next")
        #expect(try await f.runner.translate(RunnerInput(text: "hello", limit: 100)).model == model)
        _ = try await f.settings.update { $0.activeConnectionId = nil }
        #expect(try await f.runner.translate(RunnerInput(text: "hello", limit: 100)).model == model)
        try await f.editor.remove(id: "next")
        await #expect(throws: RunnerError.noModel) { try await f.runner.translate(RunnerInput(text: "hello", limit: 100)) }
        try await f.editor.remove(id: "empty")
        await #expect(throws: RunnerError.noConnection) { try await f.runner.translate(RunnerInput(text: "hello", limit: 100)) }
    }

    @Test func translationsUseOnlyCachedCapabilitiesAndPreserveEffortOnCacheMiss() async throws {
        let f = AppFixture()
        try await f.connect(preset: .deepseek)
        await f.transport.configure(models: #"{"data":[{"id":"model","effort":{"supported_levels":[]}}]}"#)
        _ = try await f.settings.update { $0.connections[0].selectionModel?.variant = "high" }
        let before = try await f.settings.read()
        let runner = f.runner
        let cold = try await runner.translate(RunnerInput(text: "cold", limit: 100))
        #expect(cold.model.variant == "high")
        #expect(await f.transport.requests.map(\.method) == ["POST"])
        _ = try await f.editor.models(connectionId: "c1")
        #expect(try await runner.translate(RunnerInput(text: "warm", limit: 100)).model.variant == "none")
        try f.secrets.set("rotated-key", connectionId: "c1", origin: "https://provider.example")
        #expect(try await runner.translate(RunnerInput(text: "rotated", limit: 100)).model.variant == "high")
        let requests = await f.transport.requests
        #expect(requests.filter { $0.url.path.hasSuffix("/models") }.count == 1)
        #expect(requests.last?.headers["authorization"] == "Bearer rotated-key")
        #expect(try await f.settings.read() == before)
    }

    @Test func missingAppGroupIsDistinctAndLocalized() {
        #expect(throws: RunnerError.appGroupUnavailable) { try TranslationRunner.shared(containerURL: nil, keychainGroup: nil, urlPolicy: .httpsOnly) }
        for (language, expected) in [("en", "ByoGlot cannot access shared storage."), ("ru", "ByoGlot не может открыть общее хранилище.")] {
            var resource = UserFacingError.message(.appGroupUnavailable)
            resource.locale = Locale(identifier: language)
            #expect(String(localized: resource) == expected)
        }
    }
}
