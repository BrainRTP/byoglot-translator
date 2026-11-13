@testable import ByoGlotAppKit
import ByoGlotCore
import Foundation
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
    func emit(_ index: Int, text: String, complete: Bool = false, chunkId: UUID? = nil, detected: String? = nil) {
        let input = inputs[index]
        let output = RunnerOutput(text: text, sourceLang: input.sourceLang ?? "auto", targetLang: input.targetLang ?? "en", model: input.model ?? ModelRef(providerID: "custom", id: "model"), detectedSourceLang: detected)
        continuations[input.requestId]?.yield(RunnerStreamOutput(requestId: chunkId ?? input.requestId, output: output, complete: complete, incomplete: false, finishReason: complete ? "stop" : nil, usage: nil))
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

@MainActor private func makeModel(_ fixture: AppFixture, _ streams: ModelStream, auto: Bool = false, delay: Duration = .milliseconds(800)) async throws -> AppModel {
    try await fixture.connect()
    _ = try await fixture.settings.update { $0.autoTranslate = auto }
    let model = AppModel(settings: fixture.settings, editor: fixture.editor, stream: { streams.stream($0) }, delay: delay)
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
