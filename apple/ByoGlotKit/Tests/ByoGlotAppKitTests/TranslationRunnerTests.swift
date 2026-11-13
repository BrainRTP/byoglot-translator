import ByoGlotAppKit
import ByoGlotCore
import ByoGlotStore
import Foundation
import Testing

struct TranslationRunnerTests {
    @Test func translatesWithTheActiveConnectionAndDefaultTemplate() async throws {
        let f = AppFixture()
        try await f.connect()
        let output = try await f.runner.translate(RunnerInput(text: "  hello  ", limit: extensionInputLimit))
        #expect(output.text == "translated")
        #expect(output.detectedSourceLang == "en")
        let requests = await f.transport.requests
        #expect(requests.count == 1)
        #expect(requests[0].url.path == "/v1/chat/completions")
        #expect(requests[0].headers["authorization"] == "Bearer fixture-key")
        let body = try #require(JSONSerialization.jsonObject(with: requests[0].body!) as? [String: Any])
        let messages = try #require(body["messages"] as? [[String: String]])
        let expected = PromptBuilder.text(TextPromptInput(prePrompt: Contracts.builtinTemplate.settings.prePrompt ?? "", languagePrompt: LanguageProfiles.text(enabled: true, profile: "auto", targetLang: "ru", builtins: Contracts.builtinProfiles, overrides: [:]), sourceLang: "auto", targetLang: "ru", text: "hello", context: "", appName: ""))
        #expect(messages[0]["content"] == expected)
    }

    @Test func preflightOrderAndUTF16Limits() async throws {
        let f = AppFixture()
        let runner = f.runner
        await #expect(throws: RunnerError.empty) { try await runner.translate(RunnerInput(text: " \u{feff}\n", limit: 0)) }
        await #expect(throws: RunnerError.tooLong(limit: 1)) { try await runner.translate(RunnerInput(text: "😀", limit: 1)) }
        await #expect(throws: RunnerError.noConnection) { try await runner.translate(RunnerInput(text: "hi", limit: 2)) }
        try await f.connect()
        _ = try await runner.translate(RunnerInput(text: "\u{feff}😀\u{feff}", limit: 2))
        #expect(await f.transport.requests.count == 1)
        _ = try await f.settings.update { $0.connections[0].selectionModel = nil }
        await #expect(throws: RunnerError.noModel) { try await runner.translate(RunnerInput(text: "hi", limit: 2)) }
    }

    @Test func consentIsRequiredForRemoteButNotLocalOrLAN() async throws {
        let f = AppFixture()
        try await f.connect(consent: false)
        await #expect(throws: RunnerError.consentNeeded(origin: "https://provider.example")) { try await f.runner.translate(RunnerInput(text: "hi", limit: 10)) }
        #expect(await f.transport.requests.isEmpty)
        for host in ["localhost", "192.168.1.2", "server.local"] {
            try await f.connect(base: "http://\(host)/v1", consent: false)
            _ = try await f.runner.translate(RunnerInput(text: "hi", limit: 10))
        }
        try await f.connect(base: "http://localhost/v1", consent: false)
        try f.secrets.delete(connectionId: "c1")
        _ = try await f.runner.translate(RunnerInput(text: "hi", limit: 10))
        try await f.connect(base: "http://192.168.1.2/v1", consent: false)
        try f.secrets.delete(connectionId: "c1")
        await #expect(throws: RunnerError.keyMissing) { try await f.runner.translate(RunnerInput(text: "hi", limit: 10)) }
    }

    @Test func changedOriginAndLockedKeychain() async throws {
        let f = AppFixture()
        try await f.connect()
        _ = try await f.settings.update { state in
            state.connections[0].baseUrl = "https://new.example/v1"
            state.consentedOrigins.append("https://new.example")
        }
        await #expect(throws: RunnerError.keyMissing) { try await f.runner.translate(RunnerInput(text: "hi", limit: 10)) }
        let locked = TranslationRunner(settings: f.settings, secrets: LockedSecrets(), transport: f.transport)
        await #expect(throws: RunnerError.deviceLocked) { try await locked.translate(RunnerInput(text: "hi", limit: 10)) }
    }

    @Test func backendErrorsPassThroughWithoutProviderPayload() async throws {
        let f = AppFixture()
        try await f.connect()
        await f.transport.configure(status: 429)
        await #expect(throws: RunnerError.backend(BackendError(kind: .rateLimit, status: 429))) { try await f.runner.translate(RunnerInput(text: "private input", limit: 100)) }
    }

    @Test func overridesAndUnsupportedEffortAreTransient() async throws {
        let f = AppFixture()
        try await f.connect()
        let chosen = Template(id: "special", name: "Special", builtin: false, settings: TemplateSettings(prePrompt: "template instructions", targetLang: "de"))
        let main = ModelRef(providerID: "custom", id: "main", variant: "high", connectionId: "c1")
        _ = try await f.settings.update { state in
            state.templates.append(chosen)
            state.mainModel = main
        }
        let before = try await f.settings.read()
        let output = try await f.runner.translate(RunnerInput(text: "hello", templateId: "special", limit: 100, pair: .main, sourceLang: "en", targetLang: "fr", prePrompt: "ephemeral pre-prompt"))
        #expect(output.targetLang == "fr")
        #expect(output.sourceLang == "en")
        #expect(output.detectedSourceLang == nil)
        #expect(output.model.id == "main")
        #expect(output.model.variant == "none")
        #expect(try await f.settings.read() == before)
        let requests = await f.transport.requests
        let request = try #require(requests.last)
        let body = String(decoding: request.body!, as: UTF8.self)
        #expect(body.contains("ephemeral pre-prompt"))
        #expect(!body.contains("template instructions"))
        let templateOutput = try await f.runner.translate(RunnerInput(text: "hello", templateId: "special", limit: 100))
        #expect(templateOutput.targetLang == "de")
        let prompt = String(decoding: (await f.transport.requests.last)!.body!, as: UTF8.self)
        #expect(prompt.contains("template instructions"))
        let explicit = ModelRef(providerID: "custom", id: "override", connectionId: "c1")
        #expect(try await f.runner.translate(RunnerInput(text: "hello", limit: 100, model: explicit)).model.id == "override")
    }

    @Test func streamCarriesRequestIdentityMetadataAndFinalOutput() async throws {
        let f = AppFixture()
        try await f.connect()
        await f.transport.configure(streamBody: "data: {\"choices\":[{\"delta\":{\"content\":\" he\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"llo \"},\"finish_reason\":\"length\"}],\"usage\":{\"total_tokens\":9}}\n\ndata: [DONE]\n\n")
        let input = RunnerInput(text: "hello", limit: 100)
        var chunks: [RunnerStreamOutput] = []
        for try await chunk in f.runner.stream(input) { chunks.append(chunk) }
        #expect(chunks.map(\.requestId).allSatisfy { $0 == input.requestId })
        #expect(chunks.first?.output.text == " he")
        #expect(chunks.last?.output.text == "hello")
        #expect(chunks.last?.complete == true)
        #expect(chunks.last?.incomplete == true)
        #expect(chunks.last?.usage?.totalTokens == 9)
        #expect(chunks.last?.output.detectedSourceLang == nil)
        let request = try #require(await f.transport.requests.last)
        let body = try #require(JSONSerialization.jsonObject(with: request.body!) as? [String: Any])
        #expect(body["stream"] as? Bool == true)
        #expect(request.headers["accept"] == "text/event-stream, application/json")
        await f.transport.configure()
        for try await chunk in f.runner.stream(RunnerInput(text: "hello", limit: 100)) {
            if chunk.complete { #expect(chunk.output.detectedSourceLang == "en") }
        }
    }
}
