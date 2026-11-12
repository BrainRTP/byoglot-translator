import Foundation
import Testing
import ByoGlotStore

public enum SecretStoreChecks: Sendable {
    public static func roundTrip<S: SecretStore>(_ store: S) throws {
        let id = UUID().uuidString
        defer { try? store.delete(connectionId: id) }
        try store.set("fixture-key", connectionId: id, origin: "https://api.deepseek.com")
        #expect(try store.has(connectionId: id))
        #expect(try store.secret(connectionId: id, origin: "https://api.deepseek.com") == "fixture-key")
    }

    public static func refusesAnotherOrigin<S: SecretStore>(_ store: S) throws {
        let id = UUID().uuidString
        defer { try? store.delete(connectionId: id) }
        try store.set("fixture-key", connectionId: id, origin: "https://api.deepseek.com")
        #expect(throws: SecretError.originMismatch) {
            try store.secret(connectionId: id, origin: "https://evil.example")
        }
    }

    public static func missingSecretIsNil<S: SecretStore>(_ store: S) throws {
        let id = UUID().uuidString
        #expect(try !store.has(connectionId: id))
        #expect(try store.secret(connectionId: id, origin: "https://example.com") == nil)
    }

    public static func deleteRemovesIt<S: SecretStore>(_ store: S) throws {
        let id = UUID().uuidString
        defer { try? store.delete(connectionId: id) }
        try store.set("fixture-key", connectionId: id, origin: "https://api.deepseek.com")
        try store.delete(connectionId: id)
        try store.delete(connectionId: id)
        #expect(try !store.has(connectionId: id))
        #expect(try store.secret(connectionId: id, origin: "https://api.deepseek.com") == nil)
    }

    public static func setReplacesSecretAndOrigin<S: SecretStore>(_ store: S) throws {
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
