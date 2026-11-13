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
