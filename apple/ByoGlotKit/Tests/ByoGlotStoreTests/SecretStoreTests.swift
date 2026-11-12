import Foundation
import Testing
import ByoGlotStore
import ByoGlotStoreTesting


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
