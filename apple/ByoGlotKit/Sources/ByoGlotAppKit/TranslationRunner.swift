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

    public init(text: String, context: String = "", appName: String = "", templateId: String? = nil, limit: Int, pair: ModelPair = .external, sourceLang: String? = nil, targetLang: String? = nil, model: ModelRef? = nil, prePrompt: String? = nil, requestId: UUID = UUID()) {
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

public struct RunnerStreamOutput: Sendable, Equatable, CustomStringConvertible, CustomDebugStringConvertible {
    public var requestId: UUID
    public var output: RunnerOutput
    public var complete: Bool
    public var incomplete: Bool
    public var finishReason: String?
    public var usage: TokenUsage?
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
    private var cached: ClientState?

    private struct ClientState: CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
        let connection: Connection
        let secret: String?
        let translator: Translator
        var description: String { "ClientState" }
        var debugDescription: String { description }
        var customMirror: Mirror { Mirror(self, children: ["summary": description]) }
    }

    public init(settings: SettingsStore, secrets: any SecretStore, transport: any HTTPTransport, detector: any SourceLanguageDetecting = OnDeviceLanguageDetector(), modelCapabilities: ModelCapabilitiesCache = .shared, urlPolicy: AppProviderURLPolicy) {
        self.settings = settings
        self.secrets = secrets
        self.transport = transport
        self.detector = detector
        self.modelCapabilities = modelCapabilities
        self.urlPolicy = urlPolicy
    }

    public static func shared(appGroup: String, keychainGroup: String?, urlPolicy: AppProviderURLPolicy) throws -> TranslationRunner {
        try shared(containerURL: FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup), keychainGroup: keychainGroup, urlPolicy: urlPolicy)
    }

    static func shared(containerURL: URL?, keychainGroup: String?, urlPolicy: AppProviderURLPolicy) throws -> TranslationRunner {
        guard let directory = containerURL else { throw RunnerError.appGroupUnavailable }
        return TranslationRunner(settings: SettingsStore(directory: directory), secrets: KeychainSecretStore(accessGroup: keychainGroup), transport: URLSessionTransport(), urlPolicy: urlPolicy)
    }

    public func translate(_ input: RunnerInput) async throws(RunnerError) -> RunnerOutput {
        do {
            let prepared = try await prepare(input)
            let text = try await prepared.translator.translate(prepared.request)
            return output(text: text, request: prepared.request, completed: true)
        } catch { throw runnerError(error) }
    }

    public nonisolated func stream(_ input: RunnerInput) -> AsyncThrowingStream<RunnerStreamOutput, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let prepared = try await self.prepare(input)
                    for try await chunk in prepared.translator.stream(prepared.request) {
                        try Task.checkCancellation()
                        let output = await self.output(text: chunk.text, request: prepared.request, completed: chunk.complete && !chunk.incomplete)
                        continuation.yield(RunnerStreamOutput(requestId: input.requestId, output: output, complete: chunk.complete, incomplete: chunk.incomplete, finishReason: chunk.finishReason, usage: chunk.usage))
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

    private func prepare(_ input: RunnerInput) async throws -> (translator: Translator, request: TextRequest) {
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
        if !HTTPDestinationPolicy.isLocalOrLAN(url.host ?? ""), !state.consentedOrigins.contains(origin) { throw RunnerError.consentNeeded(origin: origin) }
        let secret: String?
        do { secret = try secrets.secret(connectionId: connection.id, origin: origin) }
        catch { throw secretRunnerError(error) }
        if (secret?.isEmpty ?? true) && ProviderEffort.needsKey(preset: connection.preset, baseUrl: connection.baseUrl) { throw RunnerError.keyMissing }
        let client = ProviderClient(connection: connection, secret: secret, transport: transport)
        model = await modelCapabilities.clamp(model, connection: connection, secret: secret)
        let translator: Translator
        if let cached, cached.connection == connection, cached.secret == secret { translator = cached.translator }
        else {
            translator = Translator(generator: { client })
            cached = ClientState(connection: connection, secret: secret, translator: translator)
        }
        let target = input.targetLang ?? effective.targetLang
        let language = LanguageProfiles.text(enabled: state.globals.languagePromptEnabled, profile: state.globals.languageProfile, targetLang: target, builtins: Contracts.builtinProfiles, overrides: state.profileOverrides)
        return (translator, TextRequest(text: text, context: input.context, appName: input.appName, sourceLang: input.sourceLang ?? state.globals.sourceLang, targetLang: target, prePrompt: input.prePrompt ?? effective.prePrompt, languagePrompt: language, model: model))
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
