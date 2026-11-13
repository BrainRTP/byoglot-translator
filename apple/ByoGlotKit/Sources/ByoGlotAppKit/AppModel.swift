import ByoGlotCore
import ByoGlotStore
import Foundation
import Observation

public enum AppActivity: Sendable { case active, inactive, background }

@MainActor public protocol TranslationBackgroundTask: AnyObject {
    func begin(expiration: @escaping @MainActor @Sendable () -> Void)
    func end()
}

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
    public private(set) var resultAnimation: ResultAnimationPlayback?
    public private(set) var completionID: UUID?
    public private(set) var online = false
    public private(set) var activity = AppActivity.active
    public private(set) var models: [String: [ModelInfo]] = [:]
    public private(set) var keyStates: [String: Bool] = [:]
    public private(set) var catalogueErrors: [String: RunnerError] = [:]
    public private(set) var recentLanguages: [String] = []
    public private(set) var cacheStatistics = TranslationCacheStatistics()
    public var interfaceLanguage: String { AppStrings.interfaceLanguage }
    public let editor: ConnectionEditor
    @ObservationIgnored private let store: SettingsStore
    @ObservationIgnored private let stream: Stream
    @ObservationIgnored private let delay: Duration
    @ObservationIgnored private let backgroundTask: (any TranslationBackgroundTask)?
    @ObservationIgnored private let translationCache: (any TranslationCaching)?
    @ObservationIgnored private var latestChunk: RunnerStreamOutput?
    @ObservationIgnored private var pending: Task<Void, Never>?
    @ObservationIgnored private var request: Task<Void, Never>?
    private var composing = false
    @ObservationIgnored private var requestId: UUID?
    @ObservationIgnored private var choiceRevision = 0
    private var manualTarget: String?
    private var manualModel: ModelRef?
    private var manualPrompt: String?

    public init(settings: SettingsStore, editor: ConnectionEditor, runner: TranslationRunner, online: Bool = false, backgroundTask: (any TranslationBackgroundTask)? = nil) {
        self.store = settings
        self.editor = editor
        self.stream = { input in runner.stream(input) }
        self.delay = .milliseconds(800)
        self.online = online
        self.backgroundTask = backgroundTask
        self.translationCache = runner.translationCache
    }

    init(settings: SettingsStore, editor: ConnectionEditor, stream: @escaping Stream, online: Bool = true, delay: Duration = .milliseconds(800), backgroundTask: (any TranslationBackgroundTask)? = nil, translationCache: (any TranslationCaching)? = nil) {
        self.store = settings
        self.editor = editor
        self.stream = stream
        self.delay = delay
        self.online = online
        self.backgroundTask = backgroundTask
        self.translationCache = translationCache
    }

    public var targetLang: String { selection.targetLang }
    public var template: Template { settings.templates.first { $0.id == selection.templateId } ?? Contracts.builtinTemplate }
    public var model: ModelRef? {
        if let manualModel { return clamp(manualModel) }
        if missingTemplateModel != nil { return clamp(SettingsLogic.fallbackModel(settings: settings, main: true)) }
        return clamp(SettingsLogic.effectiveMain(template: template, settings: settings).model)
    }
    public var prePrompt: String { manualPrompt ?? SettingsLogic.effectiveMain(template: template, settings: settings).prePrompt }
    public var changed: Bool {
        let effective = SettingsLogic.effectiveMain(template: template, settings: settings)
        return targetLang != effective.targetLang || model != clamp(effective.model) || prePrompt != effective.prePrompt
    }
    public var canSwap: Bool { sourceLang != "auto" || detectedSourceLang != nil }
    public nonisolated static func inputCount(_ text: String) -> Int { text.utf16.count }
    public var inputCount: Int { Self.inputCount(inputText) }
    public var overLimit: Bool { inputCount > editorInputLimit }
    public var canTranslate: Bool { !composing && !jsTrim(inputText).isEmpty && !overLimit }
    public var providerName: String { model.flatMap { SettingsLogic.modelConnection($0, settings: settings)?.name } ?? "ByoGlot" }

    private struct ConnectionInput: Equatable {
        let id: String
        let preset: ProviderPreset
        let baseURL: String
        init(_ connection: Connection) { id = connection.id; preset = connection.preset; baseURL = connection.baseUrl }
    }
    private struct Inputs: Equatable {
        let text: String
        let source: String
        let target: String
        let prompt: String
        let model: ModelRef?
        let connection: ConnectionInput?
        let languagePrompt: String
    }
    private var inputs: Inputs {
        Inputs(text: jsTrim(inputText), source: sourceLang, target: targetLang, prompt: prePrompt, model: model,
               connection: model.flatMap { SettingsLogic.modelConnection($0, settings: settings) }.map(ConnectionInput.init),
               languagePrompt: LanguageProfiles.text(enabled: settings.globals.languagePromptEnabled, profile: settings.globals.languageProfile, targetLang: targetLang, builtins: Contracts.builtinProfiles, overrides: settings.profileOverrides))
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
            for connection in settings.connections {
                keyStates[connection.id] = await editor.keyState(connectionId: connection.id)
                models[connection.id] = await editor.cachedModels(connectionId: connection.id)
            }
            if !first && before != inputs { invalidate(); schedule() }
            else if previous.autoTranslate != settings.autoTranslate {
                pending?.cancel()
                if settings.autoTranslate && !complete && !running { schedule() }
            }
        } catch { storageError = .appGroupUnavailable }
    }

    @discardableResult
    public func updateSettings(_ change: @Sendable (inout AppSettings) -> Void) async -> Bool {
        do { _ = try await store.update(change); await refresh(); return true }
        catch { storageError = .appGroupUnavailable; return false }
    }

    public func edit(_ text: String, pasted: Bool = false, composing: Bool = false) {
        let wasComposing = self.composing
        self.composing = composing
        guard text != inputText else {
            if pasted && settings.autoTranslate { translate() }
            else if wasComposing && !composing { schedule() }
            return
        }
        inputText = text
        detectedSourceLang = nil
        invalidate()
        guard !composing else { return }
        if pasted && settings.autoTranslate { translate() } else { schedule() }
    }

    private func schedule() {
        pending?.cancel()
        guard loaded, activity != .background, settings.autoTranslate, canTranslate else { return }
        pending = Task { [weak self, delay] in
            do { try await Task.sleep(for: delay) } catch { return }
            guard !Task.isCancelled else { return }
            self?.translate()
        }
    }

    public func keyboardTranslate() { if !settings.autoTranslate { translate() } }

    public func translate() {
        startTranslation(reloadCache: false)
    }

    public func translateAgain() {
        startTranslation(reloadCache: true)
    }

    private func startTranslation(reloadCache: Bool) {
        guard !composing, activity != .background else { return }
        cancelTasks()
        error = nil
        errorAt = nil
        complete = false
        incomplete = false
        result = ""
        guard !jsTrim(inputText).isEmpty else { return }
        guard !overLimit else { error = .tooLong(limit: editorInputLimit); errorAt = .now; return }
        guard online || translationCache != nil else { error = .backend(BackendError(kind: .offline)); errorAt = .now; return }
        let id = UUID()
        requestId = id
        let input = RunnerInput(text: inputText, templateId: selection.templateId, limit: editorInputLimit, pair: .main, sourceLang: sourceLang, targetLang: targetLang, model: model, prePrompt: prePrompt, requestId: id, reloadCache: reloadCache, networkAvailable: online)
        running = true
        request = Task { [weak self, stream] in
            var latest: RunnerStreamOutput?
            do {
                var lastPaint = ContinuousClock.now
                for try await chunk in stream(input) {
                    guard !Task.isCancelled, let self, self.requestId == id, chunk.requestId == id else { continue }
                    latest = chunk
                    self.latestChunk = chunk
                    if chunk.complete || self.result.isEmpty || lastPaint.duration(to: .now) >= .milliseconds(50) {
                        self.apply(chunk)
                        lastPaint = .now
                    }
                }
                guard !Task.isCancelled, let self, self.requestId == id else { return }
                if let latest { self.apply(latest) }
                self.running = false
                if !self.complete { self.error = self.activity == .background ? .interrupted : .backend(BackendError(kind: .badResponse)); self.errorAt = .now }
                self.backgroundTask?.end()
            } catch {
                guard !Task.isCancelled, let self, self.requestId == id else { return }
                if let latest { self.apply(latest) }
                self.running = false
                self.error = self.activity == .background ? .interrupted : runnerError(error)
                self.errorAt = .now
                self.backgroundTask?.end()
            }
        }
    }

    private func apply(_ chunk: RunnerStreamOutput) {
        result = chunk.output.text
        complete = chunk.complete
        incomplete = chunk.incomplete
        running = !chunk.complete
        if chunk.complete { backgroundTask?.end() }
        if chunk.complete && !chunk.incomplete {
            detectedSourceLang = chunk.output.detectedSourceLang
            if completionID != chunk.requestId {
                completionID = chunk.requestId
                if ResultAnimationPolicy.shouldPlay(effect: settings.resultAnimation, delivery: chunk.delivery, complete: chunk.complete, incomplete: chunk.incomplete, hasText: !result.isEmpty, reduceMotion: false, isNewResult: true), activity == .active {
                    resultAnimation = ResultAnimationPlayback(id: chunk.requestId, effect: settings.resultAnimation)
                }
            }
        }
    }

    public func stop() {
        let interrupted = running
        if let latestChunk, latestChunk.requestId == requestId { apply(latestChunk) }
        cancelTasks()
        if interrupted { markInterrupted() }
    }

    private func cancelTasks() {
        resultAnimation = nil
        requestId = nil
        latestChunk = nil
        pending?.cancel()
        request?.cancel()
        pending = nil
        request = nil
        running = false
        backgroundTask?.end()
    }

    private func markInterrupted() {
        complete = false
        incomplete = false
        error = .interrupted
        errorAt = .now
    }

    public func sceneChanged(_ value: AppActivity) {
        guard value != activity else { return }
        activity = value
        if value != .active { resultAnimation = nil }
        switch value {
        case .inactive: break
        case .active:
            backgroundTask?.end()
            if !running && result.isEmpty { schedule() }
        case .background:
            pending?.cancel()
            pending = nil
            guard running, let id = requestId else { return }
            backgroundTask?.begin { [weak self] in
                guard let self, self.activity == .background, self.running, self.requestId == id else { return }
                if let chunk = self.latestChunk { self.apply(chunk) }
                self.cancelTasks()
                self.markInterrupted()
            }
        }
    }

    private func invalidate() {
        choiceRevision += 1
        cancelTasks()
        result = ""
        complete = false
        incomplete = false
        error = nil
    }

    public func setNetworkAvailable(_ available: Bool) {
        let restored = !online && available
        online = available
        if !available && running {
            if let latestChunk { apply(latestChunk) }
            cancelTasks()
            error = .backend(BackendError(kind: .offline))
            errorAt = .now
        } else if restored, settings.autoTranslate, case .backend(let backend) = error, backend.kind == .offline { translate() }
    }

    public func chooseSource(_ code: String) async {
        guard code != sourceLang, code == "auto" || Contracts.languageCodes.contains(code) else { return }
        rememberLanguage(code)
        sourceLang = code
        detectedSourceLang = nil
        invalidate()
        let revision = choiceRevision
        await updateSettings { $0.globals.sourceLang = code }
        guard revision == choiceRevision else { return }
        if canTranslate { translate() }
    }

    public func chooseTarget(_ code: String) async {
        guard Contracts.languageCodes.contains(code), selection.selectTarget(code) else { return }
        manualTarget = code
        rememberLanguage(code)
        invalidate()
        let revision = choiceRevision
        await updateSettings { $0.globals.targetLang = code }
        guard revision == choiceRevision else { return }
        if canTranslate { translate() }
    }

    public func chooseTemplate(_ value: Template) async {
        let before = inputs
        guard selection.selectTemplate(value) else { return }
        manualTarget = nil
        manualModel = nil
        manualPrompt = nil
        let changed = before != inputs
        if changed { invalidate() }
        let revision = choiceRevision
        await updateSettings { $0.globals.defaultTemplateId = value.id }
        guard revision == choiceRevision else { return }
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

    public var templateChanges: Bool {
        (manualTarget != nil && template.settings.targetLang != manualTarget) ||
        (manualModel != nil && clamp(template.settings.pageModel) != manualModel)
    }

    public var missingTemplateModel: ModelRef? {
        guard let own = template.settings.pageModel else { return nil }
        guard let bound = SettingsLogic.bindModel(own, settings: settings) else { return own }
        if let id = bound.connectionId, let catalogue = models[id], !catalogue.contains(where: { $0.id == bound.id && $0.providerID == bound.providerID }) { return own }
        return nil
    }

    public func modelInfo(_ ref: ModelRef?) -> ModelInfo? {
        guard let ref, let id = ref.connectionId else { return nil }
        return models[id]?.first { $0.id == ref.id && $0.providerID == ref.providerID }
    }

    public func clampedModel(_ ref: ModelRef?) -> ModelRef? { clamp(ref) }

    public func resetParameters() {
        let before = inputs
        manualTarget = nil
        manualModel = nil
        manualPrompt = nil
        _ = selection.selectTarget(SettingsLogic.effectiveMain(template: template, settings: settings).targetLang)
        if before != inputs { invalidate(); if canTranslate { translate() } }
    }

    @discardableResult
    public func storeCurrentTemplate(name: String? = nil) async -> Bool {
        guard name != nil || (template.id != Contracts.builtinTemplate.id && !template.builtin && templateChanges) else { return false }
        if let name, jsTrim(name).isEmpty { return false }
        var saved = template
        if let name { saved.id = UUID().uuidString; saved.name = jsTrim(name); saved.builtin = false }
        if let manualTarget { saved.settings.targetLang = manualTarget }
        if let manualModel { saved.settings.pageModel = manualModel }
        // A parameter prompt is never written, including when creating a template.
        let value = saved
        let target = manualTarget
        let chosenModel = manualModel
        let creating = name != nil
        guard await updateSettings({ state in
            if creating { state.templates.append(value) }
            else {
                guard let index = state.templates.firstIndex(where: { $0.id == value.id && !$0.builtin }) else { return }
                if let target { state.templates[index].settings.targetLang = target }
                if let chosenModel { state.templates[index].settings.pageModel = chosenModel }
            }
            state.globals.defaultTemplateId = value.id
        }), let stored = settings.templates.first(where: { $0.id == value.id && !$0.builtin }) else { return false }
        _ = selection.selectTemplate(stored)
        manualTarget = nil
        manualModel = nil
        return true
    }

    @discardableResult
    public func saveTemplate(_ value: Template, base: Template? = nil) async -> Bool {
        guard value.id != Contracts.builtinTemplate.id, !value.builtin, !jsTrim(value.name).isEmpty,
              base == nil || base?.id == value.id,
              settings.templates.first(where: { $0.id == value.id })?.builtin != true else { return false }
        var draft = TemplateDraft(template: base)
        draft.value = value
        let changes = draft
        guard await updateSettings({ state in
            if let index = state.templates.firstIndex(where: { $0.id == value.id }) {
                guard !state.templates[index].builtin else { return }
                state.templates[index] = changes.applyingChanges(to: state.templates[index])
            } else if base == nil { state.templates.append(value) }
        }) else { return false }
        return settings.templates.contains { $0.id == value.id && !$0.builtin }
    }

    @discardableResult
    public func deleteTemplate(_ id: String) async -> Bool {
        guard id != Contracts.builtinTemplate.id, let value = settings.templates.first(where: { $0.id == id }), !value.builtin else { return false }
        let selected = template.id == id
        guard await updateSettings({ state in
            state.templates.removeAll { $0.id == id }
            state.siteRules.removeAll { $0.templateId == id }
            if state.globals.defaultTemplateId == id { state.globals.defaultTemplateId = Contracts.builtinTemplate.id }
        }) else { return false }
        if selected { await chooseTemplate(Contracts.builtinTemplate) }
        return true
    }

    public func setConfiguredModel(_ value: ModelRef, slot: String) async {
        let before = inputs
        guard await updateSettings({ state in
            switch slot {
            case "main": state.mainModel = value
            case "external": state.externalModel = value
            case "fallback": state.fallbackModel = value
            default: break
            }
        }) else { return }
        if before != inputs && canTranslate { translate() }
    }

    public func setInterfaceLanguage(_ code: String) {
        guard ["system", "en", "ru"].contains(code), interfaceLanguage != code else { return }
        UserDefaults.standard.set(code, forKey: AppStrings.interfaceLanguageKey)
        InterfaceLocale.shared.set(code)
    }

    public func saveProfile(id: String, text: String) async -> Bool {
        guard let base = Contracts.builtinProfiles[id], text.utf16.count <= Contracts.limits.maxProfileText else { return false }
        let override = ProfileOverride(text: text, base: base, savedAt: Date.now.timeIntervalSince1970 * 1000)
        return await updateSettings { $0.profileOverrides[id] = override }
    }

    public func exportData(now: Date = .now) async throws -> Data {
        let file = SettingsLogic.export(try await store.read(), now: now)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(file)
    }

    public nonisolated static func sanitizedImport(_ file: ExportFile) -> ExportFile {
        var result = file
        result.templates = file.templates.filter { $0.id != Contracts.builtinTemplate.id }.map { template in
            var custom = template
            custom.builtin = false
            return custom
        }
        return result
    }

    public func applyImport(_ file: ExportFile) async -> Bool {
        let file = Self.sanitizedImport(file)
        let before = inputs
        do {
            settings = try await store.update { state in state = SettingsLogic.merge(file, into: state) }
            await clearTranslationCache()
            sourceLang = settings.globals.sourceLang
            selection = LanguageSelection(targetLang: settings.globals.targetLang)
            _ = selection.selectTemplate(settings.templates.first { $0.id == settings.globals.defaultTemplateId } ?? Contracts.builtinTemplate)
            manualTarget = nil
            manualModel = nil
            manualPrompt = nil
            if before != inputs { invalidate(); schedule() }
            storageError = nil
            return true
        } catch { storageError = .appGroupUnavailable; return false }
    }

    private func rememberLanguage(_ code: String) {
        guard Contracts.languageCodes.contains(code) else { return }
        recentLanguages.removeAll { $0 == code }
        recentLanguages.insert(code, at: 0)
        recentLanguages = Array(recentLanguages.prefix(5))
    }

    @discardableResult
    public func swap() async -> String? {
        guard let source = sourceLang == "auto" ? detectedSourceLang : sourceLang else { return nil }
        let oldSource = inputText
        let oldResult = result
        let ready = complete && !incomplete && error == nil
        let oldTarget = targetLang
        cancelTasks()
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
        await refreshCacheStatistics()
    }

    public func refreshCacheStatistics() async {
        cacheStatistics = await translationCache?.statistics() ?? TranslationCacheStatistics()
    }

    public func clearTranslationCache() async {
        await translationCache?.clear()
        await refreshCacheStatistics()
    }

    deinit { pending?.cancel(); request?.cancel() }

    private func clamp(_ value: ModelRef?) -> ModelRef? {
        guard var value, let id = value.connectionId, let catalogue = models[id], let info = catalogue.first(where: { $0.id == value.id && $0.providerID == value.providerID }) else { return value }
        if let variant = value.variant, variant != "none", !info.variants.contains(variant) { value.variant = "none" }
        return value
    }
}
