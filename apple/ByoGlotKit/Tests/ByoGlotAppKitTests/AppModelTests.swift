@testable import ByoGlotAppKit
import ByoGlotCore
import Foundation
import Darwin
import Testing

private actor ModelStream {
    var inputs: [RunnerInput] = []
    var continuations: [UUID: AsyncThrowingStream<RunnerStreamOutput, any Error>.Continuation] = [:]
    nonisolated func stream(_ input: RunnerInput) -> AsyncThrowingStream<RunnerStreamOutput, any Error> {
        AsyncThrowingStream { continuation in Task { await self.add(input, continuation) } }
    }
    func add(_ input: RunnerInput, _ continuation: AsyncThrowingStream<RunnerStreamOutput, any Error>.Continuation) {
        inputs.append(input)
        continuations[input.requestId] = continuation
    }
    func emit(_ index: Int, text: String, complete: Bool = false, delivery: ResultDelivery = .stream, chunkId: UUID? = nil, detected: String? = nil) {
        let input = inputs[index]
        let output = RunnerOutput(text: text, sourceLang: input.sourceLang ?? "auto", targetLang: input.targetLang ?? "en", model: input.model ?? ModelRef(providerID: "custom", id: "model"), detectedSourceLang: detected)
        continuations[input.requestId]?.yield(RunnerStreamOutput(requestId: chunkId ?? input.requestId, output: output, complete: complete, incomplete: false, finishReason: complete ? "stop" : nil, usage: nil, delivery: delivery))
    }
    func fail(_ index: Int) { continuations[inputs[index].requestId]?.finish(throwing: RunnerError.backend(BackendError(kind: .providerError, status: 503))) }
    var count: Int { inputs.count }
}

@MainActor private func eventually(_ predicate: () async -> Bool) async throws {
    let end = ContinuousClock.now.advanced(by: .seconds(3))
    while !(await predicate()) {
        if ContinuousClock.now > end { Issue.record("Timed out waiting for model state"); return }
        try await Task.sleep(for: .milliseconds(5))
    }
}

@MainActor private func makeModel(_ fixture: AppFixture, _ streams: ModelStream, auto: Bool = false, delay: Duration = .milliseconds(800), backgroundTask: (any TranslationBackgroundTask)? = nil) async throws -> AppModel {
    try await fixture.connect()
    _ = try await fixture.settings.update { $0.autoTranslate = auto }
    let model = AppModel(settings: fixture.settings, editor: fixture.editor, stream: { streams.stream($0) }, delay: delay, backgroundTask: backgroundTask)
    await model.refresh()
    return model
}

@MainActor @Test func modelRunsStreamsAndAnnouncesCompletionOnce() async throws {
    let f = AppFixture(); let stream = ModelStream(); let model = try await makeModel(f, stream)
    model.edit("Hello")
    model.translate()
    #expect(model.running && !model.complete)
    try await eventually { await stream.count == 1 }
    await stream.emit(0, text: "Привет", complete: true, detected: "en")
    try await eventually { model.complete }
    let announcement = model.completionID
    await stream.emit(0, text: "Привет", complete: true, detected: "en")
    #expect(model.completionID == announcement)
    #expect(model.result == "Привет" && model.detectedSourceLang == "en")
    #expect(model.canSwap)
    model.stop()
}

@MainActor @Test func secondRequestAndStopIgnoreLateOrMismatchedChunks() async throws {
    let f = AppFixture(); let stream = ModelStream(); let model = try await makeModel(f, stream)
    model.edit("First"); model.translate()
    try await eventually { await stream.count == 1 }
    model.edit("Second"); model.translate()
    try await eventually { await stream.count == 2 }
    await stream.emit(0, text: "stale", complete: true)
    await stream.emit(1, text: "wrong id", complete: true, chunkId: UUID())
    #expect(model.result.isEmpty)
    await stream.emit(1, text: "current", complete: true)
    try await eventually { model.result == "current" }
    model.stop()
    #expect(!model.running)
    await stream.emit(1, text: "after stop", complete: true)
    #expect(model.result == "current")
}

@MainActor @Test func partialSurvivesAnErrorBeforeTheThrottlePaints() async throws {
    let f = AppFixture(); let stream = ModelStream(); let model = try await makeModel(f, stream)
    model.edit("Hello"); model.translate()
    try await eventually { await stream.count == 1 }
    await stream.emit(0, text: "partial")
    await stream.fail(0)
    try await eventually { model.error != nil }
    #expect(model.result == "partial" && !model.running)
}

@MainActor @Test func debounceRestartsAndPasteIsImmediateOnlyWhenEnabled() async throws {
    let f = AppFixture(); let stream = ModelStream(); let model = try await makeModel(f, stream, auto: true, delay: .milliseconds(80))
    model.edit("a")
    try await Task.sleep(for: .milliseconds(45))
    model.edit("ab")
    try await Task.sleep(for: .milliseconds(45))
    #expect(await stream.count == 0)
    try await eventually { await stream.count == 1 }
    model.edit("paste", pasted: true)
    try await eventually { await stream.count == 2 }
    await model.updateSettings { $0.autoTranslate = false }
    model.edit("manual paste", pasted: true)
    try await Task.sleep(for: .milliseconds(100))
    #expect(await stream.count == 2)
    model.keyboardTranslate()
    try await eventually { await stream.count == 3 }
    model.stop()
}

@MainActor @Test func offlineBlocksAndReconnectDoesNotRetryWithAutoOff() async throws {
    let f = AppFixture(); let stream = ModelStream(); let model = try await makeModel(f, stream)
    model.edit("Hello"); model.setNetworkAvailable(false); model.translate()
    #expect(model.error == .backend(BackendError(kind: .offline)))
    #expect(await stream.count == 0)
    model.setNetworkAvailable(true)
    #expect(await stream.count == 0)
    await model.updateSettings { $0.autoTranslate = true }
    model.setNetworkAvailable(false); model.translate(); model.setNetworkAvailable(true)
    try await eventually { await stream.count == 1 }
    model.stop()
}

@MainActor @Test func identicalChoicesAndUnrelatedSettingsPreserveTheResult() async throws {
    let f = AppFixture(); let stream = ModelStream(); let model = try await makeModel(f, stream)
    model.edit("Hello"); model.translate()
    try await eventually { await stream.count == 1 }
    await stream.emit(0, text: "done", complete: true)
    try await eventually { model.complete }
    await model.chooseTarget(model.targetLang)
    await model.chooseSource(model.sourceLang)
    await model.chooseTemplate(model.template)
    if let ref = model.model { model.chooseModel(ref) }
    await model.updateSettings { $0.theme = .dark; $0.externalModel = ModelRef(providerID: "custom", id: "other", connectionId: "c1") }
    if let pinned = model.model { model.chooseModel(pinned) }
    await model.updateSettings { state in state.mainModel = ModelRef(providerID: "custom", id: "model", variant: "none", connectionId: "c1") }
    await model.setDefaultModel(connectionId: "c1", model: ModelRef(providerID: "custom", id: "another-default", connectionId: "c1"))
    await model.updateSettings { state in
        state.connections[0].name = "Renamed provider"
        state.profileOverrides["unused"] = ProfileOverride(text: "Unused instructions", base: "", savedAt: 1)
    }
    #expect(model.complete && model.result == "done")
    #expect(await stream.count == 1)
    model.stop()
}

@MainActor @Test func pickerRuleAndCompletedSwapKeepTextAndDoNotSend() async throws {
    let f = AppFixture(); let stream = ModelStream(); let model = try await makeModel(f, stream)
    await model.chooseTarget("fr")
    await model.chooseTemplate(Template(id: "inherited", name: "Inherited", builtin: false, settings: TemplateSettings()))
    #expect(model.targetLang == "fr")
    await model.chooseTemplate(Template(id: "fixed", name: "Fixed", builtin: false, settings: TemplateSettings(targetLang: "de")))
    #expect(model.targetLang == "de")
    #expect(!model.canSwap)
    model.edit("Hello"); model.translate()
    try await eventually { await stream.count == 1 }
    await stream.emit(0, text: "Hallo", complete: true, detected: "en")
    try await eventually { model.complete }
    #expect(await model.swap() == "Hallo")
    #expect(model.sourceLang == "de" && model.targetLang == "en")
    #expect(model.result == "Hello" && model.inputText == "Hallo")
    #expect(await stream.count == 1)
    model.stop()
}

@MainActor @Test func editorCountsUTF16AndBlocksWithoutTrimmingInput() async throws {
    let f = AppFixture(); let stream = ModelStream(); let model = try await makeModel(f, stream)
    model.edit(String(repeating: "😀", count: 10_000))
    #expect(model.inputCount == 20_000 && !model.overLimit)
    model.edit(model.inputText + " ")
    #expect(model.overLimit)
    model.translate()
    #expect(model.error == .tooLong(limit: 20_000))
    #expect(await stream.count == 0)
    #expect(!String(reflecting: model).contains("😀"))
}

@MainActor @Test func equivalentTemplateSelectionDoesNotChargeAgain() async throws {
    let f = AppFixture(); let stream = ModelStream(); let model = try await makeModel(f, stream)
    var duplicate = Contracts.builtinTemplate
    duplicate.id = "duplicate"
    duplicate.name = "Another name"
    duplicate.builtin = false
    let saved = duplicate
    await model.updateSettings { $0.templates.append(saved) }
    model.edit("Hello"); model.translate()
    try await eventually { await stream.count == 1 }
    await stream.emit(0, text: "done", complete: true)
    try await eventually { model.complete }
    await model.chooseTemplate(duplicate)
    #expect(model.complete && model.result == "done")
    #expect(await stream.count == 1)
    model.stop()
}

@Test func errorActionsDoNotExposeProviderDetails() {
    let limited = MainErrorPresentation(error: .backend(BackendError(kind: .rateLimit, status: 429, retryAfterMs: 5_400_000, detail: "secret response")), provider: "Provider", now: Date(timeIntervalSince1970: 0))
    #expect(limited.warning && limited.action == .model)
    #expect(!limited.message.contains("secret response"))
    let key = MainErrorPresentation(error: .backend(BackendError(kind: .providerAuth, status: 403)), provider: "Provider")
    #expect(key.action == .providers && key.message.contains("403"))
    let offline = MainErrorPresentation(error: .backend(BackendError(kind: .offline)), provider: "Provider")
    #expect(offline.action == .retry && !offline.warning)
}

@MainActor @Test func markedTextPausesDebounceUntilCompositionCommits() async throws {
    let f = AppFixture(); let stream = ModelStream(); let model = try await makeModel(f, stream, auto: true, delay: .milliseconds(20))
    model.edit("before")
    model.edit("composing", composing: true)
    model.translate()
    try await Task.sleep(for: .milliseconds(60))
    #expect(await stream.count == 0)
    #expect(!model.canTranslate)
    model.edit("composing", composing: false)
    try await eventually { await stream.count == 1 }
    #expect(model.canTranslate)
    model.stop()
}

@MainActor private final class FakeBackgroundTask: TranslationBackgroundTask {
    var expiration: (@MainActor @Sendable () -> Void)?
    var active = false
    var begins = 0
    func begin(expiration: @escaping @MainActor @Sendable () -> Void) { self.expiration = expiration; active = true; begins += 1 }
    func end() { active = false }
    func expire() { expiration?() }
}

@MainActor @Test func inactiveKeepsStreamingAndBackgroundExpirationPreservesPartial() async throws {
    let f = AppFixture(); let stream = ModelStream(); let background = FakeBackgroundTask()
    let model = try await makeModel(f, stream, backgroundTask: background)
    model.edit("Hello"); model.translate()
    try await eventually { await stream.count == 1 }
    model.sceneChanged(.inactive)
    #expect(model.running && model.error == nil)
    model.sceneChanged(.background)
    #expect(background.active && background.begins == 1)
    await stream.emit(0, text: "partial")
    try await Task.sleep(for: .milliseconds(10))
    background.expire()
    #expect(!model.running && !model.complete && model.result == "partial")
    #expect(model.error == .interrupted && !background.active)
    #expect(MainErrorPresentation(error: .interrupted, provider: "Provider").action == .retry)
    await stream.emit(0, text: "late", complete: true)
    #expect(model.result == "partial")
    model.sceneChanged(.active)
    #expect(model.error == .interrupted)
}

@MainActor @Test func backgroundCompletionEndsAssertionAndFailureShowsInterrupted() async throws {
    let f = AppFixture(); let stream = ModelStream(); let background = FakeBackgroundTask()
    let model = try await makeModel(f, stream, backgroundTask: background)
    model.edit("Hello"); model.translate()
    try await eventually { await stream.count == 1 }
    model.sceneChanged(.background)
    await stream.emit(0, text: "finished", complete: true)
    try await eventually { model.complete }
    #expect(!background.active && model.error == nil && model.result == "finished")
    model.sceneChanged(.active)
    model.translate()
    try await eventually { await stream.count == 2 }
    model.sceneChanged(.background)
    await stream.emit(1, text: "partial failure")
    await stream.fail(1)
    try await eventually { model.error != nil }
    #expect(model.error == .interrupted && !model.complete && !background.active)
    #expect(model.result == "partial failure")
}

@MainActor @Test func inactivePreservesDebounceAndActiveReschedulesBackgroundInput() async throws {
    let f = AppFixture(); let stream = ModelStream()
    let model = try await makeModel(f, stream, auto: true, delay: .milliseconds(30))
    model.edit("inactive")
    model.sceneChanged(.inactive)
    try await eventually { await stream.count == 1 }
    #expect(model.running)
    model.sceneChanged(.active)
    model.edit("background")
    model.sceneChanged(.background)
    try await Task.sleep(for: .milliseconds(60))
    #expect(await stream.count == 1)
    model.sceneChanged(.active)
    try await eventually { await stream.count == 2 }
    model.stop()
    await model.updateSettings { $0.autoTranslate = false }
    model.edit("manual")
    model.sceneChanged(.background)
    model.sceneChanged(.active)
    try await Task.sleep(for: .milliseconds(60))
    #expect(await stream.count == 2)
}

@MainActor @Test func foregroundReschedulesAnExpiredEmptyRequestOnlyWithAutoTranslate() async throws {
    let f = AppFixture(); let stream = ModelStream(); let background = FakeBackgroundTask()
    let model = try await makeModel(f, stream, auto: true, delay: .milliseconds(20), backgroundTask: background)
    model.edit("Hello", pasted: true)
    try await eventually { await stream.count == 1 }
    model.sceneChanged(.background)
    background.expire()
    #expect(model.error == .interrupted && model.result.isEmpty)
    model.sceneChanged(.active)
    try await eventually { await stream.count == 2 }
    await model.updateSettings { $0.autoTranslate = false }
    model.sceneChanged(.background)
    background.expire()
    model.sceneChanged(.active)
    try await Task.sleep(for: .milliseconds(60))
    #expect(await stream.count == 2)
    model.stop()
}

@MainActor @Test func parameterTemplateUpdateWritesOnlyEditedFieldsAndNeverThePrompt() async throws {
    let f = AppFixture(); let stream = ModelStream(); let model = try await makeModel(f, stream)
    let value = Template(id: "inherited", name: "Inherited", builtin: false, settings: TemplateSettings())
    #expect(await model.saveTemplate(value))
    await model.chooseTemplate(value)
    model.setPrePrompt("Transient instructions")
    #expect(!model.templateChanges)
    #expect(!(await model.storeCurrentTemplate()))
    await model.chooseTarget("fr")
    let chosen = ModelRef(providerID: "custom", id: "second", variant: "none", connectionId: "c1")
    model.chooseModel(chosen)
    model.edit("Hello"); model.translate()
    try await eventually { await stream.count == 1 }
    await stream.emit(0, text: "done", complete: true)
    try await eventually { model.complete }
    #expect(await model.storeCurrentTemplate())
    let saved = try #require(model.settings.templates.first { $0.id == value.id })
    #expect(saved.settings.prePrompt == nil)
    #expect(saved.settings.targetLang == "fr" && saved.settings.pageModel == chosen)
    #expect(saved.settings.selectionModel == nil)
    #expect(model.prePrompt == "Transient instructions" && model.changed)
    #expect(model.result == "done" && model.complete && !model.templateChanges)
    #expect(await stream.count == 1)
    #expect(await model.storeCurrentTemplate(name: "New template"))
    #expect(model.template.settings.prePrompt == nil && model.prePrompt == "Transient instructions")
    #expect(model.result == "done")
    #expect(await stream.count == 1)
    model.stop()
}

@MainActor @Test func promptOnlyTemplateCopyKeepsInheritedFieldsAndBuiltinCannotBeEdited() async throws {
    let f = AppFixture(); let stream = ModelStream(); let model = try await makeModel(f, stream)
    let value = Template(id: "own", name: "Own", builtin: false, settings: TemplateSettings())
    #expect(await model.saveTemplate(value))
    await model.chooseTemplate(value)
    model.setPrePrompt("Not persistent")
    #expect(await model.storeCurrentTemplate(name: "Prompt copy"))
    #expect(model.template.settings == TemplateSettings())
    var builtin = Contracts.builtinTemplate
    builtin.name = "Changed"
    builtin.builtin = false
    #expect(!(await model.saveTemplate(builtin)))
    #expect(!(await model.deleteTemplate(Contracts.builtinTemplate.id)))
    #expect(await model.deleteTemplate(model.template.id))
    #expect(model.template.id == Contracts.builtinTemplate.id)
}

@MainActor @Test func appExportAndImportPreserveDeviceSettingsAndApplyThePickerRule() async throws {
    let f = AppFixture(); let stream = ModelStream(); let model = try await makeModel(f, stream)
    let template = Template(id: "fixed", name: "Fixed", builtin: false, settings: TemplateSettings(targetLang: "de"))
    #expect(await model.saveTemplate(template))
    await model.chooseTemplate(template)
    await model.updateSettings { $0.theme = .dark; $0.autoTranslate = false; $0.externalModel = ModelRef(providerID: "custom", id: "external", connectionId: "c1") }
    let data = try await model.exportData(now: Date(timeIntervalSince1970: 0))
    let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    #expect(Set(object.keys) == ["format", "version", "exportedAt", "globals", "templates", "profileOverrides", "siteRules", "connections"])
    #expect(!String(decoding: data, as: UTF8.self).contains("apiKey"))
    var file = try ExportFile.decode(data)
    file.globals.targetLang = "fr"
    file.globals.sourceLang = "en"
    #expect(await model.applyImport(file))
    #expect(model.sourceLang == "en" && model.targetLang == "de")
    #expect(model.settings.theme == .dark && !model.settings.autoTranslate)
    #expect(model.settings.externalModel?.id == "external")
    await model.chooseTarget("it")
    await model.chooseTemplate(model.template)
    #expect(model.targetLang == "it")
    #expect(await stream.count == 0)
}

@MainActor @Test func settingsModelChoiceTranslatesOnlyWhenMainInputsDiffer() async throws {
    let f = AppFixture(); let stream = ModelStream(); let model = try await makeModel(f, stream)
    model.edit("Hello"); model.translate()
    try await eventually { await stream.count == 1 }
    await stream.emit(0, text: "done", complete: true)
    try await eventually { model.complete }
    let same = try #require(model.model)
    await model.setConfiguredModel(same, slot: "main")
    await model.setConfiguredModel(ModelRef(providerID: "custom", id: "external", connectionId: "c1"), slot: "external")
    #expect(model.complete && model.result == "done")
    #expect(await stream.count == 1)
    let next = ModelRef(providerID: "custom", id: "other", connectionId: "c1")
    await model.setConfiguredModel(next, slot: "main")
    try await eventually { await stream.count == 2 }
    await model.setConfiguredModel(next, slot: "main")
    #expect(await stream.count == 2)
    model.stop()
}

@MainActor @Test func catalogueEffortClampsTheRequestWithoutRewritingDeviceOrTemplateSettings() async throws {
    let f = AppFixture(); let stream = ModelStream(); let model = try await makeModel(f, stream)
    await model.warmModels(connectionId: "c1")
    await model.updateSettings { $0.mainModel = ModelRef(providerID: "custom", id: "model", variant: "max", connectionId: "c1") }
    #expect(model.settings.mainModel?.variant == "max" && model.model?.variant == "none")
    #expect(model.modelInfo(model.model)?.variants == ["none"])
    model.edit("Hello"); model.translate()
    try await eventually { await stream.count == 1 }
    #expect(await stream.inputs[0].model?.variant == "none")
    #expect(model.settings.mainModel?.variant == "max")
    model.stop()
}

@MainActor @Test func parameterUpdatePreservesFieldsChangedInTheStoreSinceTheSheetOpened() async throws {
    let f = AppFixture(); let stream = ModelStream(); let model = try await makeModel(f, stream)
    let template = Template(id: "concurrent", name: "Original", builtin: false, settings: TemplateSettings(targetLang: "de"))
    #expect(await model.saveTemplate(template))
    await model.chooseTemplate(template)
    await model.chooseTarget("fr")
    _ = try await f.settings.update { state in
        let index = state.templates.firstIndex { $0.id == "concurrent" }!
        state.templates[index].name = "Renamed elsewhere"
        state.templates[index].settings.prePrompt = "Stored instructions"
        state.templates[index].settings.selectionModel = ModelRef(providerID: "custom", id: "external", connectionId: "c1")
    }
    #expect(await model.storeCurrentTemplate())
    let saved = try #require(model.settings.templates.first { $0.id == "concurrent" })
    #expect(saved.name == "Renamed elsewhere")
    #expect(saved.settings.targetLang == "fr")
    #expect(saved.settings.prePrompt == "Stored instructions")
    #expect(saved.settings.selectionModel?.id == "external")
    #expect(saved.settings.pageModel == nil)
}

@MainActor @Test(arguments: [true, false]) func importCannotReplaceBuiltinAndCustomEntriesBecomeEditable(_ importedBuiltin: Bool) async throws {
    let f = AppFixture(); let stream = ModelStream(); let model = try await makeModel(f, stream)
    let expected = Contracts.builtinTemplate
    var file = try ExportFile.decode(await model.exportData())
    var poisoned = expected
    poisoned.builtin = importedBuiltin
    poisoned.settings.prePrompt = "Imported instructions"
    file.templates = [poisoned, Template(id: "custom-import", name: "Imported", builtin: true, settings: TemplateSettings())]
    #expect(await model.applyImport(file))
    #expect(model.settings.templates.first { $0.id == expected.id } == expected)
    let imported = try #require(model.settings.templates.first { $0.id == "custom-import" })
    #expect(!imported.builtin)
    #expect(await model.deleteTemplate(imported.id))
    _ = try await f.settings.update { state in
        let index = state.templates.firstIndex { $0.id == expected.id }!
        state.templates[index].builtin = false
    }
    await model.refresh()
    var forged = expected
    forged.builtin = false
    forged.name = "Changed"
    #expect(!(await model.saveTemplate(forged)))
    #expect(!(await model.deleteTemplate(expected.id)))
}

@MainActor @Test func editorSaveAfterParameterUpdatePreservesTheNewTargetAndOtherUntouchedFields() async throws {
    let f = AppFixture(); let stream = ModelStream(); let model = try await makeModel(f, stream)
    let base = Template(id: "editor", name: "Original", builtin: false, settings: TemplateSettings(prePrompt: "Keep code", targetLang: "de"))
    #expect(await model.saveTemplate(base))
    var draft = TemplateDraft(template: base)
    draft.value.name = "Renamed"
    await model.chooseTemplate(base)
    await model.chooseTarget("fr")
    #expect(await model.storeCurrentTemplate())
    #expect(await model.saveTemplate(draft.value, base: draft.base))
    let saved = try #require(model.settings.templates.first { $0.id == base.id })
    #expect(saved.name == "Renamed" && saved.settings.targetLang == "fr")
    #expect(saved.settings.prePrompt == "Keep code" && saved.settings.pageModel == nil)
    draft.rebase(on: saved)
    #expect(draft.value.settings.targetLang == "fr" && draft.value.name == "Renamed")
    #expect(draft.base == saved)
}

@MainActor @Test func overlappingTargetChoicesOnlySendTheLatestRequest() async throws {
    let f = AppFixture(); let stream = ModelStream(); let model = try await makeModel(f, stream)
    model.edit("Hello")
    let descriptor = open(f.directory.appending(path: "settings.lock").path, O_RDWR)
    #expect(descriptor >= 0)
    defer { close(descriptor) }
    #expect(flock(descriptor, LOCK_EX) == 0)
    let first = Task { await model.chooseTarget("fr") }
    try await eventually { model.targetLang == "fr" }
    let second = Task { await model.chooseTarget("de") }
    try await eventually { model.targetLang == "de" }
    #expect(flock(descriptor, LOCK_UN) == 0)
    await first.value
    await second.value
    try await eventually { await stream.count == 1 }
    #expect(await stream.inputs[0].targetLang == "de")
    #expect(await stream.count == 1)
    model.stop()
}

@MainActor @Test func wholeResultAnimationIsPublishedOnceAndCancelledWithoutChangingText() async throws {
    let f = AppFixture(); let stream = ModelStream(); let model = try await makeModel(f, stream)
    model.edit("Hello"); model.translate()
    try await eventually { await stream.count == 1 }
    await stream.emit(0, text: "whole result", complete: true, delivery: .whole)
    try await eventually { model.complete }
    let playback = try #require(model.resultAnimation)
    #expect(playback.effect == .fade && model.result == "whole result")
    await model.updateSettings { $0.resultAnimation = .wave; $0.theme = .dark }
    #expect(model.resultAnimation == playback)
    await stream.emit(0, text: "whole result", complete: true, delivery: .whole)
    model.stop()
    #expect(model.resultAnimation == nil && model.result == "whole result")
    model.translate()
    try await eventually { await stream.count == 2 }
    await stream.emit(1, text: "one SSE chunk", complete: true, delivery: .stream)
    try await eventually { model.complete }
    #expect(model.resultAnimation == nil)
    model.translate()
    try await eventually { await stream.count == 3 }
    await stream.emit(2, text: "cache result", complete: true, delivery: .cache)
    try await eventually { model.complete }
    #expect(model.resultAnimation?.effect == .wave)
    model.sceneChanged(.inactive)
    model.sceneChanged(.active)
    #expect(model.resultAnimation == nil && model.result == "cache result")
    model.edit("Edited")
    #expect(model.resultAnimation == nil && model.result.isEmpty)
}
