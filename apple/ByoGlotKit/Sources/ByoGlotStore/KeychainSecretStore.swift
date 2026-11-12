import Foundation
import Security

public struct KeychainSecretStore: SecretStore {
    private let service: String
    private let accessGroup: String?

    public init(service: String = "io.github.brainrtp.byoglot", accessGroup: String? = nil) {
        self.service = service
        self.accessGroup = accessGroup
    }

    public func set(_ secret: String, connectionId: String, origin: String) throws(SecretError) {
        try delete(connectionId: connectionId)
        var item = query(connectionId)
        item[kSecAttrComment] = origin
        item[kSecValueData] = Data(secret.utf8)
        item[kSecAttrAccessible] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
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
        let status = SecItemDelete(query(connectionId) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw .keychain(status) }
    }

    private func query(_ connectionId: String) -> [CFString: Any] {
        var query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: connectionId]
        if let accessGroup { query[kSecAttrAccessGroup] = accessGroup }
        return query
    }

    private func copy(_ connectionId: String, withData: Bool) throws(SecretError) -> [String: Any]? {
        var query = query(connectionId)
        query[kSecReturnAttributes] = true
        query[kSecReturnData] = withData
        query[kSecMatchLimit] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw .keychain(status) }
        guard let item = result as? [String: Any] else { throw .keychain(errSecDecode) }
        return item
    }
}
