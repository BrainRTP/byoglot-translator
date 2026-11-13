import ByoGlotAppKit
import ByoGlotCore
import Foundation
import Testing

struct AppProviderURLPolicyTests {
    @Test(arguments: ["http://remote.example/v1", "http://localhost:8080/v1", "http://127.0.0.1/v1", "http://192.168.1.2/v1", "http://10.0.0.2/v1", "http://172.16.0.2/v1", "http://provider.local/v1", "http://[::1]/v1", "http://[fe80::1]/v1"])
    func httpsOnlyRejectsDraftsBeforeConsentOrNetwork(_ base: String) async throws {
        let f = AppFixture()
        let editor = ConnectionEditor(settings: f.settings, secrets: f.secrets, transport: f.transport, urlPolicy: .httpsOnly)
        let draft = ConnectionDraft(preset: .custom, name: "Provider", baseUrl: base)
        #expect(editor.validate(draft, hasStoredKey: false) == .insecureRemote)
        for consent in [false, true] {
            await #expect(throws: RunnerError.backend(BackendError(kind: .providerError))) {
                try await editor.save(draft, consent: consent)
            }
        }
        #expect(await f.transport.requests.isEmpty)
        #expect(try await f.settings.read().connections.isEmpty)
    }

    @MainActor @Test(arguments: ["http://localhost:8080/v1", "http://remote.example/v1", "ftp://localhost/v1"], [false, true])
    func savedAndImportedNonHTTPSConnectionsCannotMakeRequests(_ base: String, imported: Bool) async throws {
        let f = AppFixture()
        let editor = ConnectionEditor(settings: f.settings, secrets: f.secrets, transport: f.transport, urlPolicy: .httpsOnly)
        let runner = TranslationRunner(settings: f.settings, secrets: f.secrets, transport: f.transport, urlPolicy: .httpsOnly)
        let model = AppModel(settings: f.settings, editor: editor, runner: runner, online: true)
        if imported {
            var file = SettingsLogic.export(try await f.settings.read(), now: .now)
            file.connections = [ExportConnection(id: "c1", preset: .custom, name: "Imported", baseUrl: base)]
            let decoded = try ExportFile.decode(JSONEncoder().encode(file))
            #expect(await model.applyImport(decoded))
        } else {
            try await f.connect(consent: false)
            _ = try await f.settings.update { $0.connections[0].baseUrl = base }
        }
        #expect(try await f.settings.read().connections.first?.baseUrl == base)
        let input = RunnerInput(text: "hello", limit: 100, model: ModelRef(providerID: "custom", id: "model", connectionId: "c1"))
        let expected = RunnerError.backend(BackendError(kind: .providerError))
        await #expect(throws: expected) { try await editor.models(connectionId: "c1") }
        await #expect(throws: expected) { try await runner.translate(input) }
        await #expect(throws: expected) {
            for try await _ in runner.stream(input) { Issue.record("Rejected connection produced a translation") }
        }
        await model.warmModels(connectionId: "c1")
        #expect(model.catalogueErrors["c1"] == expected)
        #expect(await f.transport.requests.isEmpty)
    }

    @Test func httpsOnlyPreservesConsentAndAcceptsHTTPS() async throws {
        let f = AppFixture()
        let editor = ConnectionEditor(settings: f.settings, secrets: f.secrets, transport: f.transport, urlPolicy: .httpsOnly)
        let draft = ConnectionDraft(preset: .custom, name: "Provider", baseUrl: "https://provider.example/v1", apiKey: "fixture-key")
        #expect(editor.validate(draft, hasStoredKey: false) == nil)
        await #expect(throws: RunnerError.consentNeeded(origin: "https://provider.example")) { try await editor.save(draft, consent: false) }
        #expect(await f.transport.requests.isEmpty)
        let saved = try await editor.save(draft, consent: true)
        #expect(try await editor.models(connectionId: saved.id).map(\.id) == ["model"])
        let runner = TranslationRunner(settings: f.settings, secrets: f.secrets, transport: f.transport, urlPolicy: .httpsOnly)
        #expect(try await runner.translate(RunnerInput(text: "hello", limit: 100)).text == "translated")
    }

    @Test func localHTTPRemainsUsableWithTheDesktopPolicy() async throws {
        let f = AppFixture()
        let editor = ConnectionEditor(settings: f.settings, secrets: f.secrets, transport: f.transport, urlPolicy: .allowLocalHTTP)
        let draft = ConnectionDraft(preset: .custom, name: "Provider", baseUrl: "http://192.168.1.2/v1", apiKey: "fixture-key")
        #expect(editor.validate(draft, hasStoredKey: false) == nil)
        _ = try await editor.save(draft, consent: false)
        let runner = TranslationRunner(settings: f.settings, secrets: f.secrets, transport: f.transport, urlPolicy: .allowLocalHTTP)
        #expect(try await runner.translate(RunnerInput(text: "hello", limit: 100)).text == "translated")
        #expect(await f.transport.requests.count == 2)
    }
}
