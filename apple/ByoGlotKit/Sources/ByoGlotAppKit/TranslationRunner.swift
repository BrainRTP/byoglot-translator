import ByoGlotCore
import ByoGlotStore
import Foundation
import Security

public let extensionInputLimit = Contracts.limits.maxSelection
public let editorInputLimit = Contracts.limits.maxEditorText
public let extensionTimeoutSeconds = 55

public enum RunnerError: Error, Equatable, Sendable {
    case noConnection, noModel, keyMissing, consentNeeded(origin: String), deviceLocked, tooLong(limit: Int), empty, appGroupUnavailable, interrupted
    case backend(BackendError)
}

public enum ModelPair: Sendable { case main, external }

public struct RunnerInput: Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    public var requestId: UUID
    public var text: String
    public var context: String
    public var appName: String
    public var templateId: String?
    public var limit: Int
    public var pair: ModelPair
    public var sourceLang: String?
    public var targetLang: String?
    public var model: ModelRef?
    public var prePrompt: String?
    public var reloadCache: Bool
    public var networkAvailable: Bool

    public init(text: String, context: String = "", appName: String = "", templateId: String? = nil, limit: Int, pair: ModelPair = .external, sourceLang: String? = nil, targetLang: String? = nil, model: ModelRef? = nil, prePrompt: String? = nil, requestId: UUID = UUID(), reloadCache: Bool = false, networkAvailable: Bool = true) {
        self.requestId = requestId
        self.text = text
        self.context = context
        self.appName = appName
        self.templateId = templateId
        self.limit = limit
        self.pair = pair
        self.sourceLang = sourceLang
        self.targetLang = targetLang
        self.model = model
        self.prePrompt = prePrompt
        self.reloadCache = reloadCache
        self.networkAvailable = networkAvailable
    }

    public var description: String { "RunnerInput(requestId: \(requestId), textLength: \(text.utf16.count))" }
    public var debugDescription: String { description }
}

public struct RunnerOutput: Sendable, Equatable, CustomStringConvertible, CustomDebugStringConvertible {
    public var text: String
    public var sourceLang: String
    public var targetLang: String
    public var model: ModelRef
    public var detectedSourceLang: String?

    public init(text: String, sourceLang: String, targetLang: String, model: ModelRef, detectedSourceLang: String? = nil) {
        self.text = text
        self.sourceLang = sourceLang
        self.targetLang = targetLang
        self.model = model
        self.detectedSourceLang = detectedSourceLang
    }

    public var description: String { "RunnerOutput(textLength: \(text.utf16.count))" }
    public var debugDescription: String { description }
}

public enum ResultDelivery: Sendable { case cache, whole, stream }

public struct RunnerStreamOutput: Sendable, Equatable, CustomStringConvertible, CustomDebugStringConvertible {
    public var requestId: UUID
    public var output: RunnerOutput
    public var complete: Bool
    public var incomplete: Bool
    public var finishReason: String?
    public var usage: TokenUsage?
    public var delivery: ResultDelivery = .stream
    public var description: String { "RunnerStreamOutput(requestId: \(requestId), complete: \(complete), incomplete: \(incomplete))" }
    public var debugDescription: String { description }
}

public actor TranslationRunner {
    private let settings: SettingsStore
    private let secrets: any SecretStore
    private let transport: any HTTPTransport
    private let modelCapabilities: ModelCapabilitiesCache
    private let detector: any SourceLanguageDetecting
    private let urlPolicy: AppProviderURLPolicy
    public nonisolated let translationCache: (any TranslationCaching)?
    private var cached: ClientState?

    private struct ClientState: CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
        let connection: Connection
        let secret: String?
        let translator: Translator
        var description: String { "ClientState" }
        var debugDescription: String { description }
        var customMirror: Mirror { Mirror(self, children: ["summary": description]) }
    }

    public init(settings: SettingsStore, secrets: any SecretStore, transport: any HTTPTransport, detector: any SourceLanguageDetecting = OnDeviceLanguageDetector(), modelCapabilities: ModelCapabilitiesCache = .shared, translationCache: (any TranslationCaching)? = nil, urlPolicy: AppProviderURLPolicy) {
        self.settings = settings
        self.secrets = secrets
        self.transport = transport
        self.detector = detector
        self.modelCapabilities = modelCapabilities
        self.urlPolicy = urlPolicy
        self.translationCache = translationCache
    }

    public static func shared(appGroup: String, keychainGroup: String?, urlPolicy: AppProviderURLPolicy) throws -> TranslationRunner {
        try shared(containerURL: FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup), keychainGroup: keychainGroup, urlPolicy: urlPolicy)
    }

    static func shared(containerURL: URL?, keychainGroup: String?, urlPolicy: AppProviderURLPolicy) throws -> TranslationRunner {
        guard let directory = containerURL else { throw RunnerError.appGroupUnavailable }
        return TranslationRunner(settings: SettingsStore(directory: directory), secrets: KeychainSecretStore(accessGroup: keychainGroup), transport: URLSessionTransport(), translationCache: TranslationCache(directory: directory.appending(path: "translation-cache-v1")), urlPolicy: urlPolicy)
    }

    public func translate(_ input: RunnerInput) async throws(RunnerError) -> RunnerOutput {
        do {
            var final: RunnerStreamOutput?
            for try await chunk in stream(input) { final = chunk }
            try Task.checkCancellation()
            guard let final, final.complete else { throw RunnerError.backend(BackendError(kind: .badResponse)) }
            guard !final.incomplete else { throw RunnerError.backend(BackendError(kind: .badResponse, detail: "incomplete completion")) }
            return final.output
        } catch { throw runnerError(error) }
    }

    public nonisolated func stream(_ input: RunnerInput) -> AsyncThrowingStream<RunnerStreamOutput, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let generation = await self.translationCache?.generation()
                    let prepared = try await self.prepare(input)
                    let lookup = await self.translationCache?.lookup(prepared.key, bypass: input.reloadCache)
                    try Task.checkCancellation()
                    if let value = lookup?.value, !input.reloadCache {
                        var output = await self.output(text: value.text, request: prepared.request, completed: true)
                        output.targetLang = value.targetLang
                        continuation.yield(RunnerStreamOutput(requestId: input.requestId, output: output, complete: true, incomplete: false, finishReason: nil, usage: nil, delivery: .cache))
                        continuation.finish()
                        return
                    }
                    let translator = try await self.authorize(prepared, networkAvailable: input.networkAvailable)
                    var final: RunnerStreamOutput?
                    for try await chunk in translator.stream(prepared.request) {
                        try Task.checkCancellation()
                        let output = await self.output(text: chunk.text, request: prepared.request, completed: chunk.complete && !chunk.incomplete)
                        let value = RunnerStreamOutput(requestId: input.requestId, output: output, complete: chunk.complete, incomplete: chunk.incomplete, finishReason: chunk.finishReason, usage: chunk.usage, delivery: chunk.delivery == .stream ? .stream : .whole)
                        final = value
                        continuation.yield(value)
                    }
                    try Task.checkCancellation()
                    if let final, final.complete, !final.incomplete, final.finishReason == nil || final.finishReason == "stop" || final.finishReason == "end_turn" {
                        await self.translationCache?.store(CachedTranslation(text: final.output.text, targetLang: final.output.targetLang), for: prepared.key, connectionId: prepared.connection.id, generation: generation)
                    }
                    continuation.finish()
                } catch { continuation.finish(throwing: runnerError(error)) }
            }
            continuation.onTermination = { @Sendable _ in task.cancel() }
        }
    }

    private func output(text: String, request: TextRequest, completed: Bool) -> RunnerOutput {
        let detected = completed && request.sourceLang == "auto" ? detector.detect(request.text) : nil
        return RunnerOutput(text: text, sourceLang: request.sourceLang, targetLang: request.targetLang, model: request.model, detectedSourceLang: detected)
    }

    private struct Prepared: Sendable {
        let request: TextRequest
        let connection: Connection
        let secret: String?
        let origin: String
        let consented: Bool
        let key: TranslationCacheKey
    }

    private func prepare(_ input: RunnerInput) async throws -> Prepared {
        let text = jsTrim(input.text)
        guard !text.isEmpty else { throw RunnerError.empty }
        guard text.utf16.count <= input.limit else { throw RunnerError.tooLong(limit: input.limit) }
        try Task.checkCancellation()
        let state = try await settings.read()
        guard !state.connections.isEmpty else { throw RunnerError.noConnection }
        let template = state.templates.first { $0.id == input.templateId } ?? state.templates.first { $0.id == state.globals.defaultTemplateId } ?? Contracts.builtinTemplate
        let effective = SettingsLogic.effectiveForApp(template: template, settings: state, main: input.pair == .main)
        guard var model = input.model ?? effective.model else { throw RunnerError.noModel }
        guard let connection = SettingsLogic.modelConnection(model, settings: state) else { throw RunnerError.noModel }
        model.connectionId = connection.id
        guard let origin = originOf(connection.baseUrl), let url = URL(string: origin), urlPolicy.permits(url) else { throw RunnerError.backend(BackendError(kind: .providerError)) }
        let secret: String?
        do { secret = try secrets.secret(connectionId: connection.id, origin: origin) }
        catch { throw secretRunnerError(error) }
        model = await modelCapabilities.clamp(model, connection: connection, secret: secret)
        let target = input.targetLang ?? effective.targetLang
        let language = LanguageProfiles.text(enabled: state.globals.languagePromptEnabled, profile: state.globals.languageProfile, targetLang: target, builtins: Contracts.builtinProfiles, overrides: state.profileOverrides)
        let request = TextRequest(text: text, context: input.context, appName: input.appName, sourceLang: input.sourceLang ?? state.globals.sourceLang, targetLang: target, prePrompt: input.prePrompt ?? effective.prePrompt, languagePrompt: language, model: model)
        return Prepared(request: request, connection: connection, secret: secret, origin: origin, consented: HTTPDestinationPolicy.isLocalOrLAN(url.host ?? "") || state.consentedOrigins.contains(origin), key: try TranslationCacheKey(connection: connection, request: request))
    }

    private func authorize(_ prepared: Prepared, networkAvailable: Bool) throws -> Translator {
        guard networkAvailable else { throw RunnerError.backend(BackendError(kind: .offline)) }
        guard prepared.consented else { throw RunnerError.consentNeeded(origin: prepared.origin) }
        let connection = prepared.connection, secret = prepared.secret
        if (secret?.isEmpty ?? true) && ProviderEffort.needsKey(preset: connection.preset, baseUrl: connection.baseUrl) { throw RunnerError.keyMissing }
        if let cached, cached.connection == connection, cached.secret == secret { return cached.translator }
        let client = ProviderClient(connection: connection, secret: secret, transport: transport)
        let translator = Translator(generator: { client }, cacheLimit: 0)
        cached = ClientState(connection: connection, secret: secret, translator: translator)
        return translator
    }
}

func secretRunnerError(_ error: SecretError) -> RunnerError {
    if error == .keychain(errSecInteractionNotAllowed) { return .deviceLocked }
    return .keyMissing
}

func runnerError(_ error: any Error) -> RunnerError {
    if let error = error as? RunnerError { return error }
    if let error = error as? SecretError { return secretRunnerError(error) }
    if let error = error as? BackendError { return .backend(BackendError(kind: error.kind, status: error.status, retryAfterMs: error.retryAfterMs)) }
    return .backend(BackendError(kind: Task.isCancelled || error is CancellationError ? .aborted : .providerError))
}
