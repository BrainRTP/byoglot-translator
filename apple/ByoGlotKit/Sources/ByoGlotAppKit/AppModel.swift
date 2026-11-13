import ByoGlotCore
import ByoGlotStore
import Foundation
import Observation

@MainActor @Observable
public final class AppModel {
    public typealias Stream = @Sendable (RunnerInput) -> AsyncThrowingStream<RunnerStreamOutput, any Error>
    public private(set) var settings = AppSettings.initial(preferredLanguage: Locale.preferredLanguages.first)
    public private(set) var loaded = false
    public private(set) var inputText = ""
    public private(set) var result = ""
    public private(set) var running = false
    public private(set) var complete = false
    public private(set) var incomplete = false
    public private(set) var error: RunnerError?
    public private(set) var errorAt: Date?
    public private(set) var storageError: RunnerError?
    public private(set) var sourceLang = "auto"
    public private(set) var selection = LanguageSelection(targetLang: "en")
    public private(set) var detectedSourceLang: String?
    public private(set) var completionID: UUID?
    public private(set) var online = false
    public private(set) var models: [String: [ModelInfo]] = [:]
    public private(set) var keyStates: [String: Bool] = [:]
    public private(set) var catalogueErrors: [String: RunnerError] = [:]
    public let editor: ConnectionEditor
    @ObservationIgnored private let store: SettingsStore
    @ObservationIgnored private let stream: Stream
    @ObservationIgnored private let delay: Duration
    @ObservationIgnored private var pending: Task<Void, Never>?
    @ObservationIgnored private var request: Task<Void, Never>?
    @ObservationIgnored private var requestId: UUID?
    private var manualModel: ModelRef?
    private var manualPrompt: String?

    public init(settings: SettingsStore, editor: ConnectionEditor, runner: TranslationRunner, online: Bool = false) {
        self.store = settings
        self.editor = editor
        self.stream = { input in runner.stream(input) }
        self.delay = .milliseconds(800)
        self.online = online
    }

    init(settings: SettingsStore, editor: ConnectionEditor, stream: @escaping Stream, online: Bool = true, delay: Duration = .milliseconds(800)) {
        self.store = settings
        self.editor = editor
        self.stream = stream
        self.delay = delay
        self.online = online
    }

    public var targetLang: String { selection.targetLang }
    public var template: Template { settings.templates.first { $0.id == selection.templateId } ?? Contracts.builtinTemplate }
    public var model: ModelRef? { clamp(manualModel ?? SettingsLogic.effectiveMain(template: template, settings: settings).model) }
    public var prePrompt: String { manualPrompt ?? SettingsLogic.effectiveMain(template: template, settings: settings).prePrompt }
    public var changed: Bool {
        let effective = SettingsLogic.effectiveMain(template: template, settings: settings)
        return targetLang != effective.targetLang || model != clamp(effective.model) || prePrompt != effective.prePrompt
    }
    public var canSwap: Bool { sourceLang != "auto" || detectedSourceLang != nil }
    public nonisolated static func inputCount(_ text: String) -> Int { text.utf16.count }
    public var inputCount: Int { Self.inputCount(inputText) }
    public var overLimit: Bool { inputCount > editorInputLimit }
    public var canTranslate: Bool { !jsTrim(inputText).isEmpty && !overLimit }
    public var providerName: String { model.flatMap { SettingsLogic.modelConnection($0, settings: settings)?.name } ?? "ByoGlot" }

    private struct Inputs: Equatable {
        let text: String
        let source: String
        let target: String
        let prompt: String
        let model: ModelRef?
        let connection: Connection?
        let languageEnabled: Bool
        let languageProfile: String
        let profiles: [String: ProfileOverride]
    }
    private var inputs: Inputs {
        Inputs(text: inputText, source: sourceLang, target: targetLang, prompt: prePrompt, model: model,
               connection: model.flatMap { SettingsLogic.modelConnection($0, settings: settings) },
               languageEnabled: settings.globals.languagePromptEnabled, languageProfile: settings.globals.languageProfile, profiles: settings.profileOverrides)
    }

    public func refresh() async {
        do {
            let before = inputs
            let previous = settings
            let first = !loaded
            settings = try await store.read()
            if let manualModel, SettingsLogic.bindModel(manualModel, settings: settings) == nil { self.manualModel = nil }
            if first {
                sourceLang = settings.globals.sourceLang
                selection = LanguageSelection(targetLang: settings.globals.targetLang)
                _ = selection.selectTemplate(settings.templates.first { $0.id == settings.globals.defaultTemplateId } ?? Contracts.builtinTemplate)
                loaded = true
            }
            storageError = nil
            for connection in settings.connections { keyStates[connection.id] = await editor.keyState(connectionId: connection.id) }
            if !first && before != inputs { invalidate(); schedule() }
            else if previous.autoTranslate != settings.autoTranslate {
                pending?.cancel()
                if settings.autoTranslate && !complete && !running { schedule() }
            }
        } catch { storageError = .appGroupUnavailable }
    }

    public func updateSettings(_ change: @Sendable (inout AppSettings) -> Void) async {
        do { _ = try await store.update(change); await refresh() }
        catch { storageError = .appGroupUnavailable }
    }

    public func edit(_ text: String, pasted: Bool = false) {
        guard text != inputText else { if pasted && settings.autoTranslate { translate() }; return }
        inputText = text
        detectedSourceLang = nil
        invalidate()
        if pasted && settings.autoTranslate { translate() } else { schedule() }
    }

    private func schedule() {
        pending?.cancel()
        guard loaded, settings.autoTranslate, canTranslate else { return }
        pending = Task { [weak self, delay] in
            do { try await Task.sleep(for: delay) } catch { return }
            guard !Task.isCancelled else { return }
            self?.translate()
        }
    }

    public func keyboardTranslate() { if !settings.autoTranslate { translate() } }

    public func translate() {
        stop()
        error = nil
        errorAt = nil
        complete = false
        incomplete = false
        result = ""
        guard !jsTrim(inputText).isEmpty else { return }
        guard !overLimit else { error = .tooLong(limit: editorInputLimit); errorAt = .now; return }
        guard online else { error = .backend(BackendError(kind: .offline)); errorAt = .now; return }
        let id = UUID()
        requestId = id
        let input = RunnerInput(text: inputText, templateId: selection.templateId, limit: editorInputLimit, pair: .main, sourceLang: sourceLang, targetLang: targetLang, model: model, prePrompt: prePrompt, requestId: id)
        running = true
        request = Task { [weak self, stream] in
            var latest: RunnerStreamOutput?
            do {
                var lastPaint = ContinuousClock.now
                for try await chunk in stream(input) {
                    guard !Task.isCancelled, let self, self.requestId == id, chunk.requestId == id else { continue }
                    latest = chunk
                    if chunk.complete || lastPaint.duration(to: .now) >= .milliseconds(50) {
                        self.apply(chunk)
                        lastPaint = .now
                    }
                }
                guard !Task.isCancelled, let self, self.requestId == id else { return }
                if let latest { self.apply(latest) }
                self.running = false
                if !self.complete { self.error = .backend(BackendError(kind: .badResponse)); self.errorAt = .now }
            } catch {
                guard !Task.isCancelled, let self, self.requestId == id else { return }
                if let latest { self.apply(latest) }
                self.running = false
                self.error = (error as? RunnerError) ?? .backend(BackendError(kind: .providerError))
                self.errorAt = .now
            }
        }
    }

    private func apply(_ chunk: RunnerStreamOutput) {
        result = chunk.output.text
        complete = chunk.complete
        incomplete = chunk.incomplete
        running = !chunk.complete
        if chunk.complete {
            detectedSourceLang = chunk.output.detectedSourceLang
            if completionID != chunk.requestId { completionID = chunk.requestId }
        }
    }

    public func stop() {
        requestId = nil
        pending?.cancel()
        request?.cancel()
        pending = nil
        request = nil
        running = false
    }

    private func invalidate() {
        stop()
        result = ""
        complete = false
        incomplete = false
        error = nil
    }

    public func setNetworkAvailable(_ available: Bool) {
        let restored = !online && available
        online = available
        if !available && running {
            stop()
            error = .backend(BackendError(kind: .offline))
            errorAt = .now
        } else if restored, settings.autoTranslate, case .backend(let backend) = error, backend.kind == .offline { translate() }
    }

    public func chooseSource(_ code: String) async {
        guard code != sourceLang, code == "auto" || Contracts.languageCodes.contains(code) else { return }
        sourceLang = code
        detectedSourceLang = nil
        invalidate()
        await updateSettings { $0.globals.sourceLang = code }
        if canTranslate { translate() }
    }

    public func chooseTarget(_ code: String) async {
        guard Contracts.languageCodes.contains(code), selection.selectTarget(code) else { return }
        invalidate()
        await updateSettings { $0.globals.targetLang = code }
        if canTranslate { translate() }
    }

    public func chooseTemplate(_ value: Template) async {
        let before = inputs
        guard selection.selectTemplate(value) else { return }
        manualModel = nil
        manualPrompt = nil
        let changed = before != inputs
        if changed { invalidate() }
        await updateSettings { $0.globals.defaultTemplateId = value.id }
        if changed && canTranslate { translate() }
    }

    public func chooseModel(_ value: ModelRef) {
        guard let selected = clamp(value), selected != model, SettingsLogic.modelConnection(selected, settings: settings) != nil else { return }
        manualModel = selected
        invalidate()
        if canTranslate { translate() }
    }

    public func setPrePrompt(_ value: String) {
        guard value != prePrompt else { return }
        manualPrompt = value
        invalidate()
        schedule()
    }

    @discardableResult
    public func swap() async -> String? {
        guard let source = sourceLang == "auto" ? detectedSourceLang : sourceLang else { return nil }
        let oldSource = inputText
        let oldResult = result
        let ready = complete && !incomplete && error == nil
        let oldTarget = targetLang
        stop()
        sourceLang = oldTarget
        _ = selection.selectTarget(source)
        detectedSourceLang = nil
        await updateSettings { $0.globals.sourceLang = oldTarget; $0.globals.targetLang = source }
        if ready {
            inputText = oldResult
            result = oldSource
            complete = true
            error = nil
            return oldResult
        }
        invalidate()
        schedule()
        return nil
    }

    public func warmModels(connectionId: String) async {
        guard online else { catalogueErrors[connectionId] = .backend(BackendError(kind: .offline)); return }
        do {
            models[connectionId] = try await editor.models(connectionId: connectionId)
            catalogueErrors[connectionId] = nil
        } catch { catalogueErrors[connectionId] = error }
    }

    public func setDefaultModel(connectionId: String, model: ModelRef) async {
        var bound = model
        bound.connectionId = connectionId
        let chosen = bound
        await updateSettings { state in
            guard let index = state.connections.firstIndex(where: { $0.id == connectionId }) else { return }
            state.connections[index].pageModel = chosen
            state.connections[index].selectionModel = chosen
        }
    }

    public func removeConnection(_ id: String) async throws {
        try await editor.remove(id: id)
        models[id] = nil
        keyStates[id] = nil
        await refresh()
    }

    deinit { pending?.cancel(); request?.cancel() }

    private func clamp(_ value: ModelRef?) -> ModelRef? {
        guard var value, let id = value.connectionId, let catalogue = models[id], let info = catalogue.first(where: { $0.id == value.id && $0.providerID == value.providerID }) else { return value }
        if let variant = value.variant, variant != "none", !info.variants.contains(variant) { value.variant = "none" }
        return value
    }
}
