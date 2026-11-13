import ByoGlotCore
import ByoGlotStore
import Foundation

public struct ConnectionDraft: Sendable, Equatable, CustomStringConvertible, CustomDebugStringConvertible {
    public var id: String?
    public var preset: ProviderPreset
    public var name: String
    public var baseUrl: String
    public var apiKey: String

    public init(id: String? = nil, preset: ProviderPreset, name: String, baseUrl: String, apiKey: String = "") {
        self.id = id
        self.preset = preset
        self.name = name
        self.baseUrl = baseUrl
        self.apiKey = apiKey
    }

    public var description: String { "ConnectionDraft(preset: \(preset.rawValue))" }
    public var debugDescription: String { description }
}

public enum DraftProblem: Equatable, Sendable { case baseUrl, apiKey, insecureRemote }

public actor ConnectionEditor {
    private let settings: SettingsStore
    private let secrets: any SecretStore
    private let transport: any HTTPTransport

    public init(settings: SettingsStore, secrets: any SecretStore, transport: any HTTPTransport) {
        self.settings = settings
        self.secrets = secrets
        self.transport = transport
    }

    public nonisolated static func presets(includeLocal: Bool = false) -> [ProviderPreset] {
        Contracts.presetOrder.filter { preset in
            if preset == .custom || includeLocal { return true }
            guard let url = URL(string: Contracts.presets[preset]!.baseUrl) else { return true }
            return !HTTPDestinationPolicy.isLocalOrLAN(url.host ?? "")
        }
    }

    public nonisolated func validate(_ draft: ConnectionDraft, hasStoredKey: Bool) -> DraftProblem? {
        guard originOf(draft.baseUrl) != nil, let url = URL(string: draft.baseUrl) else { return .baseUrl }
        guard HTTPDestinationPolicy.permits(url) else { return .insecureRemote }
        if ProviderEffort.needsKey(preset: draft.preset, baseUrl: draft.baseUrl), jsTrim(draft.apiKey).isEmpty, !hasStoredKey { return .apiKey }
        return nil
    }

    public func save(_ draft: ConnectionDraft, consent: Bool) async throws(RunnerError) -> Connection {
        do {
            guard let origin = originOf(draft.baseUrl), let url = URL(string: origin), HTTPDestinationPolicy.permits(url) else { throw RunnerError.backend(BackendError(kind: .offline)) }
            let local = HTTPDestinationPolicy.isLocalOrLAN(url.host ?? "")
            if !local && !consent { throw RunnerError.consentNeeded(origin: origin) }
            let state = try await settings.read()
            let old = state.connections.first { $0.id == draft.id }
            let id = old?.id ?? UUID().uuidString
            if let old, originOf(old.baseUrl) != origin { try secrets.delete(connectionId: id) }
            let typed = jsTrim(draft.apiKey)
            let secret = typed.isEmpty ? try secrets.secret(connectionId: id, origin: origin) : typed
            if (secret?.isEmpty ?? true) && ProviderEffort.needsKey(preset: draft.preset, baseUrl: draft.baseUrl) { throw RunnerError.keyMissing }
            var connection = Connection(id: id, preset: draft.preset, name: draft.name, baseUrl: draft.baseUrl, pageModel: old?.pageModel, selectionModel: old?.selectionModel)
            let client = ProviderClient(connection: connection, secret: secret, transport: transport)
            let listed = try await client.modelsWithDefault()
            if old == nil || old?.preset != draft.preset || old?.baseUrl != draft.baseUrl {
                let initial = SettingsLogic.pickInitialModels(models: listed.models, defaultModel: listed.defaultModel, connectionId: id)
                connection.pageModel = initial.page
                connection.selectionModel = initial.selection
            }
            if !typed.isEmpty { try secrets.set(typed, connectionId: id, origin: origin) }
            let saved = connection
            _ = try await settings.update { settings in
                if let index = settings.connections.firstIndex(where: { $0.id == id }) { settings.connections[index] = saved }
                else { settings.connections.append(saved) }
                settings.activeConnectionId = id
                if !local && !settings.consentedOrigins.contains(origin) { settings.consentedOrigins.append(origin) }
            }
            return connection
        } catch { throw runnerError(error) }
    }

    public func remove(id: String) async throws {
        try secrets.delete(connectionId: id)
        _ = try await settings.update { state in
            state.connections.removeAll { $0.id == id }
            if state.activeConnectionId == id { state.activeConnectionId = nil }
            if state.mainModel?.connectionId == id { state.mainModel = nil }
            if state.externalModel?.connectionId == id { state.externalModel = nil }
            if state.fallbackModel?.connectionId == id { state.fallbackModel = nil }
        }
    }

    public func models(connectionId: String) async throws(RunnerError) -> [ModelInfo] {
        do {
            let state = try await settings.read()
            guard let connection = state.connections.first(where: { $0.id == connectionId }), let origin = originOf(connection.baseUrl), let url = URL(string: origin) else { throw RunnerError.noConnection }
            if !HTTPDestinationPolicy.isLocalOrLAN(url.host ?? ""), !state.consentedOrigins.contains(origin) { throw RunnerError.consentNeeded(origin: origin) }
            let secret = try secrets.secret(connectionId: connectionId, origin: origin)
            if (secret?.isEmpty ?? true) && ProviderEffort.needsKey(preset: connection.preset, baseUrl: connection.baseUrl) { throw RunnerError.keyMissing }
            return try await ProviderClient(connection: connection, secret: secret, transport: transport).listModels()
        } catch { throw runnerError(error) }
    }

    public func keyState(connectionId: String) async -> Bool {
        guard let state = try? await settings.read(), let connection = state.connections.first(where: { $0.id == connectionId }), let origin = originOf(connection.baseUrl) else { return false }
        guard let secret = try? secrets.secret(connectionId: connectionId, origin: origin) else { return false }
        return !secret.isEmpty
    }
}
