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
    private var mutating = false
    private var mutationWaiters: [(UUID, CheckedContinuation<Bool, Never>)] = []
    var pendingMutations: Int { mutationWaiters.count }
    private let modelCapabilities: ModelCapabilitiesCache
    private let transport: any HTTPTransport

    public init(settings: SettingsStore, secrets: any SecretStore, transport: any HTTPTransport, modelCapabilities: ModelCapabilitiesCache = .shared) {
        self.settings = settings
        self.secrets = secrets
        self.transport = transport
        self.modelCapabilities = modelCapabilities
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
            try await acquireMutation()
            defer { releaseMutation() }
            guard let origin = originOf(draft.baseUrl), let url = URL(string: origin), HTTPDestinationPolicy.permits(url) else { throw RunnerError.backend(BackendError(kind: .offline)) }
            let local = HTTPDestinationPolicy.isLocalOrLAN(url.host ?? "")
            if !local && !consent { throw RunnerError.consentNeeded(origin: origin) }
            let state = try await settings.read()
            let old = state.connections.first { $0.id == draft.id }
            let id = old?.id ?? UUID().uuidString
            let oldOrigin = old.flatMap { originOf($0.baseUrl) }
            let oldSecret = try oldOrigin.flatMap { try secrets.secret(connectionId: id, origin: $0) }
            let typed = jsTrim(draft.apiKey)
            let secret = typed.isEmpty ? (oldOrigin == origin ? oldSecret : nil) : typed
            if (secret?.isEmpty ?? true) && ProviderEffort.needsKey(preset: draft.preset, baseUrl: draft.baseUrl) { throw RunnerError.keyMissing }
            var connection = Connection(id: id, preset: draft.preset, name: draft.name, baseUrl: draft.baseUrl, pageModel: old?.pageModel, selectionModel: old?.selectionModel)
            let client = ProviderClient(connection: connection, secret: secret, transport: transport)
            let listed = try await client.modelsWithDefault()
            if old == nil || old?.preset != draft.preset || old?.baseUrl != draft.baseUrl {
                let initial = SettingsLogic.pickInitialModels(models: listed.models, defaultModel: listed.defaultModel, connectionId: id)
                connection.pageModel = initial.page
                connection.selectionModel = initial.selection
            }
            let saved = connection
            try Task.checkCancellation()
            // Finish persistence even if the caller leaves after the key write.
            try await Task {
                try await self.persist(id: id, origin: origin, secret: secret, oldOrigin: oldOrigin, oldSecret: oldSecret) { settings in
                    if let index = settings.connections.firstIndex(where: { $0.id == id }) { settings.connections[index] = saved }
                    else { settings.connections.append(saved) }
                    settings.activeConnectionId = id
                    if !local && !settings.consentedOrigins.contains(origin) { settings.consentedOrigins.append(origin) }
                }
            }.value
            await modelCapabilities.record(listed.models, connection: saved, secret: secret)
            return connection
        } catch { throw runnerError(error) }
    }

    public func remove(id: String) async throws {
        try await acquireMutation()
        defer { releaseMutation() }
        let current = try await settings.read()
        let oldOrigin = current.connections.first { $0.id == id }.flatMap { originOf($0.baseUrl) }
        let oldSecret = try oldOrigin.flatMap { try secrets.secret(connectionId: id, origin: $0) }
        try Task.checkCancellation()
        try await Task {
            try await self.persist(id: id, origin: nil, secret: nil, oldOrigin: oldOrigin, oldSecret: oldSecret) { state in
                state.connections.removeAll { $0.id == id }
                if state.activeConnectionId == id {
                    state.activeConnectionId = state.connections.first { $0.pageModel != nil || $0.selectionModel != nil }?.id
                }
                if state.mainModel?.connectionId == id { state.mainModel = nil }
                if state.externalModel?.connectionId == id { state.externalModel = nil }
                if state.fallbackModel?.connectionId == id { state.fallbackModel = nil }
            }
        }.value
        await modelCapabilities.remove(connectionId: id)
    }

    private func persist(id: String, origin: String?, secret: String?, oldOrigin: String?, oldSecret: String?, change: @Sendable (inout AppSettings) -> Void) async throws {
        if let secret, let origin { try secrets.set(secret, connectionId: id, origin: origin) }
        else { try secrets.delete(connectionId: id) }
        do { _ = try await settings.update(change) }
        catch {
            if let oldSecret, let oldOrigin { try secrets.set(oldSecret, connectionId: id, origin: oldOrigin) }
            else { try secrets.delete(connectionId: id) }
            throw error
        }
    }

    private func acquireMutation() async throws {
        try Task.checkCancellation()
        if !mutating { mutating = true; return }
        let id = UUID()
        let acquired = await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                if Task.isCancelled { continuation.resume(returning: false) }
                else { mutationWaiters.append((id, continuation)) }
            }
        } onCancel: {
            Task { await self.cancelMutation(id) }
        }
        if !acquired { throw CancellationError() }
    }

    private func cancelMutation(_ id: UUID) {
        guard let index = mutationWaiters.firstIndex(where: { $0.0 == id }) else { return }
        mutationWaiters.remove(at: index).1.resume(returning: false)
    }

    private func releaseMutation() {
        if mutationWaiters.isEmpty { mutating = false }
        else { mutationWaiters.removeFirst().1.resume(returning: true) }
    }

    public func models(connectionId: String) async throws(RunnerError) -> [ModelInfo] {
        do {
            let state = try await settings.read()
            guard let connection = state.connections.first(where: { $0.id == connectionId }), let origin = originOf(connection.baseUrl), let url = URL(string: origin) else { throw RunnerError.noConnection }
            if !HTTPDestinationPolicy.isLocalOrLAN(url.host ?? ""), !state.consentedOrigins.contains(origin) { throw RunnerError.consentNeeded(origin: origin) }
            let secret = try secrets.secret(connectionId: connectionId, origin: origin)
            if (secret?.isEmpty ?? true) && ProviderEffort.needsKey(preset: connection.preset, baseUrl: connection.baseUrl) { throw RunnerError.keyMissing }
            let models = try await ProviderClient(connection: connection, secret: secret, transport: transport).listModels()
            await modelCapabilities.record(models, connection: connection, secret: secret)
            return models
        } catch { throw runnerError(error) }
    }

    public func keyState(connectionId: String) async -> Bool {
        guard let state = try? await settings.read(), let connection = state.connections.first(where: { $0.id == connectionId }), let origin = originOf(connection.baseUrl) else { return false }
        guard let secret = try? secrets.secret(connectionId: connectionId, origin: origin) else { return false }
        return !secret.isEmpty
    }
}
