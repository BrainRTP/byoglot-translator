import ByoGlotAppKit
import ByoGlotCore
import ByoGlotStore
import Foundation
import Security

actor AppTransport: HTTPTransport {
    var requests: [HTTPRequest] = []
    var status = 200
    var streamBody: String?
    var modelBody = #"{"data":[{"id":"model","effort":{"supported_levels":["high"]}}]}"#
    let reply = #"{"choices":[{"message":{"content":"  translated  "}}]}"#

    func configure(status: Int = 200, streamBody: String? = nil, models: String? = nil) {
        self.status = status
        self.streamBody = streamBody
        if let models { modelBody = models }
    }

    func send(_ request: HTTPRequest, timeout: Duration) async throws -> HTTPResponse {
        requests.append(request)
        return HTTPResponse(status: status, headers: [:], body: Data((request.url.path.hasSuffix("/models") ? modelBody : reply).utf8))
    }

    nonisolated func stream(_ request: HTTPRequest, timeout: Duration) -> AsyncThrowingStream<HTTPStreamEvent, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                let response = await self.streamingResponse(request)
                continuation.yield(.response(HTTPResponse(status: response.status, headers: ["content-type": "text/event-stream"], body: Data())))
                for byte in response.body { continuation.yield(.data(Data([byte]))) }
                continuation.finish()
            }
            continuation.onTermination = { @Sendable _ in task.cancel() }
        }
    }

    func streamingResponse(_ request: HTTPRequest) -> HTTPResponse {
        requests.append(request)
        return HTTPResponse(status: status, headers: [:], body: Data((streamBody ?? "data: {\"choices\":[{\"delta\":{\"content\":\"translated\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n").utf8))
    }
}

struct FixedDetector: SourceLanguageDetecting {
    func detect(_ text: String) -> String? { "en" }
}

struct LockedSecrets: SecretStore {
    func set(_ secret: String, connectionId: String, origin: String) throws(SecretError) { throw .keychain(errSecInteractionNotAllowed) }
    func secret(connectionId: String, origin: String) throws(SecretError) -> String? { throw .keychain(errSecInteractionNotAllowed) }
    func has(connectionId: String) throws(SecretError) -> Bool { throw .keychain(errSecInteractionNotAllowed) }
    func delete(connectionId: String) throws(SecretError) { throw .keychain(errSecInteractionNotAllowed) }
}

final class AppFixture: Sendable {
    let directory = FileManager.default.temporaryDirectory.appending(path: "byoglot-appkit-\(UUID().uuidString)")
    let settings: SettingsStore
    let secrets = InMemorySecretStore()
    let capabilities = ModelCapabilitiesCache()
    let transport = AppTransport()
    var runner: TranslationRunner { TranslationRunner(settings: settings, secrets: secrets, transport: transport, detector: FixedDetector(), modelCapabilities: capabilities, urlPolicy: .allowLocalHTTP) }
    var editor: ConnectionEditor { ConnectionEditor(settings: settings, secrets: secrets, transport: transport, modelCapabilities: capabilities, urlPolicy: .allowLocalHTTP) }

    init() { settings = SettingsStore(directory: directory) }
    deinit { try? FileManager.default.removeItem(at: directory) }

    func connect(preset: ProviderPreset = .custom, base: String = "https://provider.example/v1", consent: Bool = true) async throws {
        let ref = ModelRef(providerID: preset.rawValue, id: "model", variant: "none", connectionId: "c1")
        let connection = Connection(id: "c1", preset: preset, name: "Provider", baseUrl: base, pageModel: ref, selectionModel: ref)
        _ = try await settings.update { state in
            state.connections = [connection]
            state.activeConnectionId = "c1"
            state.globals.targetLang = "ru"
            state.globals.sourceLang = "auto"
            state.consentedOrigins = consent ? [originOf(base)!] : []
        }
        try secrets.set("fixture-key", connectionId: "c1", origin: originOf(base)!)
    }
}
