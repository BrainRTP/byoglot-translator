import Foundation
import Testing
import ByoGlotStore

enum SecretStoreChecks {
    static func roundTrip<S: SecretStore>(_ store: S) throws {
        let id = UUID().uuidString
        defer { try? store.delete(connectionId: id) }
        try store.set("fixture-key", connectionId: id, origin: "https://api.deepseek.com")
        #expect(try store.has(connectionId: id))
        #expect(try store.secret(connectionId: id, origin: "https://api.deepseek.com") == "fixture-key")
    }

    static func refusesAnotherOrigin<S: SecretStore>(_ store: S) throws {
        let id = UUID().uuidString
        defer { try? store.delete(connectionId: id) }
        try store.set("fixture-key", connectionId: id, origin: "https://api.deepseek.com")
        #expect(throws: SecretError.originMismatch) {
            try store.secret(connectionId: id, origin: "https://evil.example")
        }
    }

    static func missingSecretIsNil<S: SecretStore>(_ store: S) throws {
        let id = UUID().uuidString
        #expect(try !store.has(connectionId: id))
        #expect(try store.secret(connectionId: id, origin: "https://example.com") == nil)
    }

    static func deleteRemovesIt<S: SecretStore>(_ store: S) throws {
        let id = UUID().uuidString
        defer { try? store.delete(connectionId: id) }
        try store.set("fixture-key", connectionId: id, origin: "https://api.deepseek.com")
        try store.delete(connectionId: id)
        try store.delete(connectionId: id)
        #expect(try !store.has(connectionId: id))
        #expect(try store.secret(connectionId: id, origin: "https://api.deepseek.com") == nil)
    }

    static func setReplacesSecretAndOrigin<S: SecretStore>(_ store: S) throws {
        let id = UUID().uuidString
        defer { try? store.delete(connectionId: id) }
        try store.set("old", connectionId: id, origin: "https://api.deepseek.com")
        try store.set("new", connectionId: id, origin: "https://example.com")
        #expect(try store.secret(connectionId: id, origin: "https://example.com") == "new")
        #expect(throws: SecretError.originMismatch) {
            try store.secret(connectionId: id, origin: "https://api.deepseek.com")
        }
    }
}

struct SecretStoreTests {
    @Test func roundTrip() throws { try SecretStoreChecks.roundTrip(InMemorySecretStore()) }
    @Test func refusesAnotherOrigin() throws { try SecretStoreChecks.refusesAnotherOrigin(InMemorySecretStore()) }
    @Test func missingSecretIsNil() throws { try SecretStoreChecks.missingSecretIsNil(InMemorySecretStore()) }
    @Test func deleteRemovesIt() throws { try SecretStoreChecks.deleteRemovesIt(InMemorySecretStore()) }
    @Test func setReplacesSecretAndOrigin() throws { try SecretStoreChecks.setReplacesSecretAndOrigin(InMemorySecretStore()) }

    @Test func originOfNormalizes() {
        let cases: [(String, String?)] = [
            ("https://api.deepseek.com/v1/", "https://api.deepseek.com"),
            ("https://api.deepseek.com:443/x", "https://api.deepseek.com"),
            ("http://localhost:80/v1/", "http://localhost"),
            ("http://localhost:8080/v1/", "http://localhost:8080"),
            ("https://API.DeepSeek.COM/path?key=value", "https://api.deepseek.com"),
            ("https://[::1]:443/v1", "https://[::1]"),
            ("not a url", nil),
        ]
        for (input, expected) in cases { #expect(originOf(input) == expected, "\(input)") }
    }
}
