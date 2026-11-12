import Foundation
import Testing
@testable import ByoGlotCore

actor FakeGenerator: TextGenerating {
    private(set) var calls = 0
    private(set) var lastPrompt: String?
    private(set) var lastModel: ModelRef?
    private(set) var peak = 0
    private var active = 0
    private var failures: [BackendError]
    private var delay: Duration
    let starts = AsyncStream<Int>.makeStream()

    init(delay: Duration = .zero, failures: [BackendError] = []) {
        self.delay = delay
        self.failures = failures
    }

    func generate(prompt: String, model: ModelRef) async throws(BackendError) -> String {
        calls += 1
        lastPrompt = prompt
        lastModel = model
        active += 1
        peak = max(peak, active)
        starts.continuation.yield(calls)
        defer { active -= 1 }
        do { try await Task.sleep(for: delay) }
        catch { throw BackendError(kind: .aborted) }
        if !failures.isEmpty { throw failures.removeFirst() }
        return "  привет \n"
    }
}

struct TranslatorTests {
    func request(_ text: String = "hello") -> TextRequest {
        TextRequest(text: text, context: "context", appName: "Notes", sourceLang: "auto", targetLang: "ru", prePrompt: "be brief", languagePrompt: "rules", model: ModelRef(providerID: "deepseek", id: "deepseek-flash", variant: "high", connectionId: "c1"))
    }

    @Test func returnsTheTrimmedAnswerAndSendsTheContractPrompt() async throws {
        let fake = FakeGenerator()
        let translator = Translator(generator: { fake })
        let i = request()
        #expect(try await translator.translate(i) == "привет")
        #expect(await fake.lastPrompt == PromptBuilder.text(TextPromptInput(prePrompt: i.prePrompt, languagePrompt: i.languagePrompt, sourceLang: i.sourceLang, targetLang: i.targetLang, text: i.text, context: i.context, appName: i.appName)))
        #expect(await fake.lastModel == i.model)
    }

    @Test func secondIdenticalRequestComesFromTheCache() async throws {
        let fake = FakeGenerator()
        let translator = Translator(generator: { fake })
        _ = try await translator.translate(request())
        _ = try await translator.translate(request())
        #expect(await fake.calls == 1)
    }

    @Test func aFailedRequestIsNotCached() async throws {
        let failure = BackendError(kind: .rateLimit)
        let fake = FakeGenerator(failures: [failure])
        let translator = Translator(generator: { fake })
        do {
            _ = try await translator.translate(request())
            Issue.record("Expected rate limit")
        } catch { #expect(error == failure) }
        #expect(try await translator.translate(request()) == "привет")
        #expect(await fake.calls == 2)
    }

    @Test func runsAtMostFourRequestsAtOnce() async throws {
        let fake = FakeGenerator(delay: .milliseconds(15))
        let translator = Translator(generator: { fake })
        try await withThrowingTaskGroup(of: String.self) { group in
            for index in 0..<10 {
                let input = request("text \(index)")
                group.addTask { try await translator.translate(input) }
            }
            for try await result in group { #expect(result == "привет") }
        }
        #expect(await fake.peak == 4)
        #expect(await fake.calls == 10)
    }

    @Test func cancellationGivesAborted() async throws {
        let fake = FakeGenerator(delay: .seconds(60))
        let translator = Translator(generator: { fake })
        let input = request()
        let task = Task { try await translator.translate(input) }
        var starts = fake.starts.stream.makeAsyncIterator()
        _ = await starts.next()
        task.cancel()
        do {
            _ = try await task.value
            Issue.record("Expected cancellation")
        } catch { #expect(error as? BackendError == BackendError(kind: .aborted)) }
    }

    @Test func cacheEvictsOldestAndClearRemovesEntries() async throws {
        let fake = FakeGenerator()
        let translator = Translator(generator: { fake }, cacheLimit: 1)
        _ = try await translator.translate(request("first"))
        var other = request("first")
        other.model.connectionId = "c2"
        _ = try await translator.translate(other)
        _ = try await translator.translate(request("first"))
        #expect(await fake.calls == 3)
        await translator.clearCache()
        _ = try await translator.translate(request("first"))
        #expect(await fake.calls == 4)
    }
}
