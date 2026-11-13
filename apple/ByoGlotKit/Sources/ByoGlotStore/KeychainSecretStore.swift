import Foundation
import Security

public struct KeychainSecretStore: SecretStore {
    private let service: String
    private let accessGroup: String?
    private let client: any KeychainClient

    public init(service: String = "io.github.brainrtp.byoglot", accessGroup: String? = nil) {
        self.init(service: service, accessGroup: accessGroup, client: SystemKeychainClient())
    }

    init(service: String, accessGroup: String?, client: any KeychainClient) {
        self.service = service
        self.accessGroup = accessGroup
        self.client = client
    }

    public func set(_ secret: String, connectionId: String, origin: String) throws(SecretError) {
        let query = query(connectionId)
        let attributes: [CFString: Any] = [
            kSecAttrComment: origin,
            kSecValueData: Data(secret.utf8),
            kSecAttrAccessible: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        var status = client.update(query, attributes: attributes)
        if status == errSecItemNotFound {
            let item = query.merging(attributes) { _, new in new }
            status = client.add(item)
            if status == errSecDuplicateItem { status = client.update(query, attributes: attributes) }
        }
        guard status == errSecSuccess else { throw .keychain(status) }
    }

    public func secret(connectionId: String, origin: String) throws(SecretError) -> String? {
        guard let item = try copy(connectionId, withData: true) else { return nil }
        guard item[kSecAttrComment as String] as? String == origin else { throw .originMismatch }
        guard let data = item[kSecValueData as String] as? Data,
              let secret = String(data: data, encoding: .utf8) else { throw .keychain(errSecDecode) }
        return secret
    }

    public func has(connectionId: String) throws(SecretError) -> Bool {
        try copy(connectionId, withData: false) != nil
    }

    public func delete(connectionId: String) throws(SecretError) {
        let status = client.delete(query(connectionId))
        guard status == errSecSuccess || status == errSecItemNotFound else { throw .keychain(status) }
    }

    private func query(_ connectionId: String) -> [CFString: Any] {
        var query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: connectionId, kSecUseDataProtectionKeychain: true]
        if let accessGroup { query[kSecAttrAccessGroup] = accessGroup }
        return query
    }

    private func copy(_ connectionId: String, withData: Bool) throws(SecretError) -> [String: Any]? {
        var query = query(connectionId)
        query[kSecReturnAttributes] = true
        query[kSecReturnData] = withData
        query[kSecMatchLimit] = kSecMatchLimitOne
        let (status, item) = client.copy(query)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw .keychain(status) }
        guard let item else { throw .keychain(errSecDecode) }
        return item
    }
}

protocol KeychainClient: Sendable {
    func update(_ query: [CFString: Any], attributes: [CFString: Any]) -> OSStatus
    func add(_ attributes: [CFString: Any]) -> OSStatus
    func copy(_ query: [CFString: Any]) -> (OSStatus, [String: Any]?)
    func delete(_ query: [CFString: Any]) -> OSStatus
}

private struct SystemKeychainClient: KeychainClient {
    func update(_ query: [CFString: Any], attributes: [CFString: Any]) -> OSStatus {
        SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    }
    func add(_ attributes: [CFString: Any]) -> OSStatus { SecItemAdd(attributes as CFDictionary, nil) }
    func copy(_ query: [CFString: Any]) -> (OSStatus, [String: Any]?) {
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        return (status, result as? [String: Any])
    }
    func delete(_ query: [CFString: Any]) -> OSStatus { SecItemDelete(query as CFDictionary) }
}
