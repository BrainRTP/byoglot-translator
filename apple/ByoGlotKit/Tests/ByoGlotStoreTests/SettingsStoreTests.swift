import Darwin
import Foundation
import Testing
import ByoGlotCore
@testable import ByoGlotStore

struct SettingsStoreTests {
    func directory() -> URL {
        FileManager.default.temporaryDirectory.appending(path: "byoglot-settings-\(UUID().uuidString)")
    }

    @Test func createsTheInitialFile() async throws {
        let directory = directory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SettingsStore(directory: directory)
        let settings = try await store.read()
        #expect(FileManager.default.fileExists(atPath: directory.appending(path: "settings.json").path))
        #expect(settings.schemaVersion == 1)
        #expect(settings.revision == 0)
        #expect(settings.templates == [Contracts.builtinTemplate])
        #expect(settings.globals.sourceLang == "auto")
        #expect(settings.globals.languagePromptEnabled)
        #expect(settings.globals.languageProfile == "auto")
        #expect(settings.consentedOrigins.isEmpty)
        #expect(try await store.read() == settings)
        #expect(AppSettings.initial(preferredLanguage: "RU_ru").globals.targetLang == "ru")
        #expect(AppSettings.initial(preferredLanguage: "unknown").globals.targetLang == "en")
        #expect(AppSettings.initial(preferredLanguage: nil).globals.targetLang == "en")
        var legacy = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(settings)) as? [String: Any])
        legacy["consentedOrigins"] = nil
        let decoded = try JSONDecoder().decode(AppSettings.self, from: JSONSerialization.data(withJSONObject: legacy))
        #expect(decoded.consentedOrigins == [])
    }

    @Test func updateBumpsTheRevisionAndPersists() async throws {
        let directory = directory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SettingsStore(directory: directory)
        let changed = try await store.update { settings in
            settings.globals.targetLang = "de"
            settings.consentedOrigins = ["https://api.deepseek.com"]
            settings.revision = 900
        }
        #expect(changed.revision == 1)
        #expect(changed.globals.targetLang == "de")
        #expect(try await SettingsStore(directory: directory).read() == changed)
        let next = try await store.update { $0.globals.sourceLang = "en" }
        #expect(next.revision == 2)
        #expect(next.consentedOrigins == changed.consentedOrigins)
    }

    @Test func futureThemeAndPresetDoNotHideKnownSettings() async throws {
        let directory = directory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SettingsStore(directory: directory)
        let original = try await store.read()
        var object = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as? [String: Any])
        object["theme"] = "future-theme"
        let known: [String: Any] = ["id": "known", "preset": "custom", "name": "Known", "baseUrl": "https://provider.example/v1"]
        let future: [String: Any] = ["id": "future", "preset": "future-provider", "name": "Future", "baseUrl": "https://future.example/v1", "selectionModel": ["providerID": "future-provider", "id": "model", "connectionId": "future"], "metadata": ["enabled": true, "values": [1, NSNull(), "keep"]]]
        let another = ["preset": "another-provider"]
        object["connections"] = [future, known, another]
        object["activeConnectionId"] = "future"
        object["consentedOrigins"] = ["https://future.example"]
        object["externalModel"] = future["selectionModel"]
        let data = try JSONSerialization.data(withJSONObject: object)
        let file = directory.appending(path: "settings.json")
        try data.write(to: file)
        let loaded = try await store.read()
        #expect(loaded.theme == .system)
        #expect(loaded.connections == [Connection(id: "known", preset: .custom, name: "Known", baseUrl: "https://provider.example/v1")])
        #expect(loaded.templates == original.templates && loaded.globals == original.globals)
        #expect(try Data(contentsOf: file) == data)
        #expect(SettingsLogic.bindModel(try #require(loaded.externalModel), settings: loaded) == nil)
        _ = try await store.update { $0.theme = .dark }
        let changed = try await store.update { $0.globals.targetLang = "de" }
        #expect(try await SettingsStore(directory: directory).read() == changed)
        #expect(changed.theme == .dark && changed.globals.targetLang == "de")
        #expect(changed.connections == loaded.connections)
        #expect(changed.activeConnectionId == loaded.activeConnectionId)
        #expect(changed.consentedOrigins == loaded.consentedOrigins)
        #expect(changed.externalModel == loaded.externalModel)
        let persisted = try JSONDecoder().decode([String: JSONValue].self, from: Data(contentsOf: file))
        let records = try JSONDecoder().decode([JSONValue].self, from: JSONSerialization.data(withJSONObject: [known, future, another]))
        #expect(persisted["connections"] == .array(records))
        var malformed = known
        malformed["baseUrl"] = 42
        object["connections"] = [malformed]
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(AppSettings.self, from: JSONSerialization.data(withJSONObject: object)) }
        object["connections"] = [known]
        object["theme"] = 42
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(AppSettings.self, from: JSONSerialization.data(withJSONObject: object)) }
    }

    @Test(arguments: ["future-display-mode", "replace", "bilingual"])
    func templateDisplayModesDoNotHideOtherSettings(_ mode: String) async throws {
        let directory = directory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SettingsStore(directory: directory)
        var original = try await store.read()
        original.templates.append(Template(id: "custom", name: "Custom", builtin: false, settings: TemplateSettings(prePrompt: "Keep", targetLang: "de", visibleOnly: false)))
        var object = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as? [String: Any])
        var templates = try #require(object["templates"] as? [[String: Any]])
        var settings = try #require(templates[1]["settings"] as? [String: Any])
        settings["displayMode"] = mode
        templates[1]["settings"] = settings
        object["templates"] = templates
        try JSONSerialization.data(withJSONObject: object).write(to: directory.appending(path: "settings.json"))
        var expected = original
        expected.templates[1].settings.displayMode = DisplayMode(rawValue: mode)
        #expect(try await store.read() == expected)
        let changed = try await store.update { $0.theme = .dark }
        expected.theme = .dark
        expected.revision += 1
        #expect(changed == expected)
        #expect(try await SettingsStore(directory: directory).read() == expected)
        settings["displayMode"] = 42
        templates[1]["settings"] = settings
        object["templates"] = templates
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(AppSettings.self, from: JSONSerialization.data(withJSONObject: object)) }
    }

    @Test func twoStoresOnOneDirectoryDoNotLoseUpdates() async throws {
        let directory = directory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let first = SettingsStore(directory: directory)
        let second = SettingsStore(directory: directory)
        _ = try await first.read()
        _ = try await second.read()
        let a = Template(id: "a", name: "A", builtin: false, settings: TemplateSettings())
        let b = Template(id: "b", name: "B", builtin: false, settings: TemplateSettings())
        async let one = first.update { $0.templates.append(a) }
        async let two = second.update { $0.templates.append(b) }
        _ = try await (one, two)
        let fresh = try await SettingsStore(directory: directory).read()
        #expect(Set(fresh.templates.map(\.id)) == Set([Contracts.builtinTemplate.id, "a", "b"]))
        #expect(fresh.revision == 2)
        #expect(try await first.read() == fresh)
        #expect(try await second.read() == fresh)
    }
    private func holdLock(_ directory: URL) throws -> Int32 {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let descriptor = open(directory.appending(path: "settings.lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0, flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            if descriptor >= 0 { close(descriptor) }
            throw POSIXError(.EIO)
        }
        return descriptor
    }

    @Test func aBusySettingsLockHasABoundedWait() async throws {
        let directory = directory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let descriptor = try holdLock(directory)
        defer { close(descriptor) }
        let store = SettingsStore(directory: directory, lockTimeout: .milliseconds(20))
        do {
            _ = try await store.read()
            Issue.record("Expected lock contention")
        } catch { #expect((error as? POSIXError)?.code == .EWOULDBLOCK) }
        #expect(!FileManager.default.fileExists(atPath: directory.appending(path: "settings.json").path))
    }

    @Test func waitingForASettingsLockIsCancellable() async throws {
        let directory = directory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let descriptor = try holdLock(directory)
        defer { close(descriptor) }
        let store = SettingsStore(directory: directory)
        let task = Task { try await store.read() }
        try await Task.sleep(for: .milliseconds(20))
        task.cancel()
        do {
            _ = try await task.value
            Issue.record("Expected cancellation")
        } catch { #expect(error is CancellationError) }
    }

}

@Test func resultAnimationPersistsLocallyAndLegacySettingsDefaultToFade() async throws {
    let directory = FileManager.default.temporaryDirectory.appending(path: "byoglot-animation-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = SettingsStore(directory: directory)
    #expect(try await store.read().resultAnimation == .fade)
    _ = try await store.update { $0.resultAnimation = .pen }
    let stored = try await SettingsStore(directory: directory).read()
    #expect(stored.resultAnimation == .pen)
    let exported = SettingsLogic.export(stored, now: .now)
    let exportObject = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(exported)) as? [String: Any])
    #expect(exportObject["resultAnimation"] == nil)
    #expect(SettingsLogic.merge(exported, into: stored).resultAnimation == .pen)
    var legacy = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(stored)) as? [String: Any])
    legacy["resultAnimation"] = nil
    #expect(try JSONDecoder().decode(AppSettings.self, from: JSONSerialization.data(withJSONObject: legacy)).resultAnimation == .fade)
    legacy["resultAnimation"] = "unknown"
    #expect(try JSONDecoder().decode(AppSettings.self, from: JSONSerialization.data(withJSONObject: legacy)).resultAnimation == .fade)
}
