import ByoGlotAppKit
import ByoGlotCore
import ByoGlotStore
import Foundation
import Testing

struct ConnectionEditorTests {
    @Test func validateTableAndPresetOrder() {
        let f = AppFixture()
        let editor = f.editor
        let rows: [(String, String, Bool, DraftProblem?)] = [
            ("invalid", "key", false, .baseUrl),
            ("http://remote.example", "key", false, .insecureRemote),
            ("https://remote.example", "", false, .apiKey),
            ("https://remote.example", "", true, nil),
            ("http://localhost:8080", "", false, nil),
            ("http://192.168.1.2", "key", false, nil),
        ]
        for (base, key, stored, expected) in rows {
            #expect(editor.validate(ConnectionDraft(preset: .custom, name: "Test", baseUrl: base, apiKey: key), hasStoredKey: stored) == expected)
        }
        #expect(ConnectionEditor.presets() == [.deepseek, .openrouter, .openai, .mistral, .custom])
        #expect(ConnectionEditor.presets(includeLocal: true) == Contracts.presetOrder)
    }

    @Test func saveChecksModelsStoresTheKeyAndActivates() async throws {
        let f = AppFixture()
        let draft = ConnectionDraft(preset: .custom, name: "Provider", baseUrl: "https://provider.example/v1", apiKey: "fixture-key")
        let connection = try await f.editor.save(draft, consent: true)
        let state = try await f.settings.read()
        #expect(state.activeConnectionId == connection.id)
        #expect(state.connections == [connection])
        #expect(state.consentedOrigins == ["https://provider.example"])
        #expect(connection.selectionModel?.id == "model")
        #expect(try f.secrets.secret(connectionId: connection.id, origin: "https://provider.example") == "fixture-key")
        #expect(await f.editor.keyState(connectionId: connection.id))
        #expect(await f.transport.requests.count == 1)
        #expect(try await f.editor.models(connectionId: connection.id).map(\.id) == ["model"])
        try await f.editor.remove(id: connection.id)
        #expect(try !f.secrets.has(connectionId: connection.id))
        #expect(try await f.settings.read().activeConnectionId == nil)
    }

    @Test func saveWithoutConsentFailsBeforeNetwork() async throws {
        let f = AppFixture()
        await #expect(throws: RunnerError.consentNeeded(origin: "https://provider.example")) {
            try await f.editor.save(ConnectionDraft(preset: .custom, name: "Provider", baseUrl: "https://provider.example/v1", apiKey: "fixture-key"), consent: false)
        }
        #expect(await f.transport.requests.isEmpty)
        #expect(try await f.settings.read().connections.isEmpty)
    }

    @Test func modelsFailureDoesNotPersistDraftOrKey() async throws {
        let f = AppFixture()
        try await f.connect()
        let before = try await f.settings.read()
        await f.transport.configure(status: 401)
        await #expect(throws: RunnerError.backend(BackendError(kind: .providerAuth, status: 401))) {
            try await f.editor.save(ConnectionDraft(id: "c1", preset: .custom, name: "Changed", baseUrl: "https://provider.example/v1", apiKey: "replacement-key"), consent: true)
        }
        #expect(try await f.settings.read() == before)
        #expect(try f.secrets.secret(connectionId: "c1", origin: "https://provider.example") == "fixture-key")
    }

    @Test func editingToAnotherOriginDeletesOldKeyBeforeCheckingModels() async throws {
        let f = AppFixture()
        try await f.connect()
        let changed = ConnectionDraft(id: "c1", preset: .custom, name: "Changed", baseUrl: "https://other.example/v1")
        await #expect(throws: RunnerError.consentNeeded(origin: "https://other.example")) { try await f.editor.save(changed, consent: false) }
        #expect(try f.secrets.has(connectionId: "c1"))
        await #expect(throws: RunnerError.keyMissing) { try await f.editor.save(changed, consent: true) }
        #expect(try !f.secrets.has(connectionId: "c1"))
        #expect(await f.transport.requests.isEmpty)
        var replacement = changed
        replacement.apiKey = "new-key"
        _ = try await f.editor.save(replacement, consent: true)
        #expect(try f.secrets.secret(connectionId: "c1", origin: "https://other.example") == "new-key")
        #expect(await f.transport.requests.first?.headers["authorization"] == "Bearer new-key")
    }

    @Test func noProviderDefaultSavesWithoutAModel() async throws {
        let f = AppFixture()
        let connection = try await f.editor.save(ConnectionDraft(preset: .openai, name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "fixture-key"), consent: true)
        #expect(connection.pageModel == nil)
        #expect(connection.selectionModel == nil)
        await #expect(throws: RunnerError.noModel) { try await f.runner.translate(RunnerInput(text: "hello", limit: 100)) }
        await f.transport.configure(models: #"{"data":[{"id":"embedding","capabilities":{"completion_chat":false}}]}"#)
        let mistral = try await f.editor.save(ConnectionDraft(preset: .mistral, name: "Mistral", baseUrl: "https://api.mistral.ai/v1", apiKey: "fixture-key"), consent: true)
        #expect(mistral.selectionModel == nil)
    }

    @Test func importedConnectionsHaveNoKeysAndDevicePreferencesSurvive() async throws {
        let f = AppFixture()
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let export = try ExportFile.decode(Data(contentsOf: root.appending(path: "contracts/samples/export-v1.json")))
        let ref = ModelRef(providerID: "custom", id: "device", variant: "high", connectionId: "device")
        _ = try await f.settings.update { state in
            state.theme = .dark
            state.autoTranslate = false
            state.mainModel = ref
            state.externalModel = ref
            state.fallbackModel = ref
            state = SettingsLogic.merge(export, into: state)
        }
        let state = try await f.settings.read()
        #expect(state.theme == .dark)
        #expect(!state.autoTranslate)
        #expect(state.mainModel == ref && state.externalModel == ref && state.fallbackModel == ref)
        for connection in state.connections { #expect(await !f.editor.keyState(connectionId: connection.id)) }
        let output = try JSONEncoder().encode(SettingsLogic.export(state, now: Date(timeIntervalSince1970: 0)))
        let object = try #require(JSONSerialization.jsonObject(with: output) as? [String: Any])
        for key in ["theme", "autoTranslate", "mainModel", "externalModel", "fallbackModel"] { #expect(object[key] == nil) }
        var legacy = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(state)) as? [String: Any])
        for key in ["theme", "autoTranslate", "mainModel", "externalModel", "fallbackModel"] { legacy.removeValue(forKey: key) }
        let decoded = try JSONDecoder().decode(AppSettings.self, from: JSONSerialization.data(withJSONObject: legacy))
        #expect(decoded.theme == .system && decoded.autoTranslate)
        #expect(decoded.mainModel == nil && decoded.externalModel == nil && decoded.fallbackModel == nil)
    }
}
