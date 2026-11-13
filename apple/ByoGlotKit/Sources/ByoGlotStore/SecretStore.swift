import Foundation
import Security
import Synchronization

public enum SecretError: Error, Equatable, Sendable {
    case originMismatch
    case keychain(OSStatus)
}

public protocol SecretStore: Sendable {
    func set(_ secret: String, connectionId: String, origin: String) throws(SecretError)
    func secret(connectionId: String, origin: String) throws(SecretError) -> String?
    func has(connectionId: String) throws(SecretError) -> Bool
    func delete(connectionId: String) throws(SecretError)
}

public func originOf(_ baseUrl: String) -> String? {
    guard let url = URL(string: baseUrl), let scheme = url.scheme?.lowercased(),
          ["http", "https"].contains(scheme), let rawHost = url.host?.lowercased(), !rawHost.isEmpty else { return nil }
    let host = rawHost.contains(":") && !rawHost.hasPrefix("[") ? "[\(rawHost)]" : rawHost
    let defaultPort = scheme == "https" ? 443 : 80
    let suffix = url.port.flatMap { $0 == defaultPort ? nil : ":\($0)" } ?? ""
    return "\(scheme)://\(host)\(suffix)"
}

public final class InMemorySecretStore: SecretStore {
    private struct Entry: Sendable {
        let secret: String
        let origin: String
    }
    private let entries = Mutex<[String: Entry]>([:])

    public init() {}

    public func set(_ secret: String, connectionId: String, origin: String) throws(SecretError) {
        entries.withLock { $0[connectionId] = Entry(secret: secret, origin: origin) }
    }

    public func secret(connectionId: String, origin: String) throws(SecretError) -> String? {
        guard let entry = entries.withLock({ $0[connectionId] }) else { return nil }
        guard entry.origin == origin else { throw .originMismatch }
        return entry.secret
    }

    public func has(connectionId: String) throws(SecretError) -> Bool {
        entries.withLock { $0[connectionId] != nil }
    }

    public func delete(connectionId: String) throws(SecretError) {
        entries.withLock { $0[connectionId] = nil }
    }
}
