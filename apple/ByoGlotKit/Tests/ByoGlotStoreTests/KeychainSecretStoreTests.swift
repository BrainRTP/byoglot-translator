import Foundation
import Security
import Synchronization
import Testing
@testable import ByoGlotStore

private final class RecordingKeychain: KeychainClient {
    struct Query: Sendable {
        let dataProtection: Bool?
        let accessGroup: String?
        init(_ query: [CFString: Any]) {
            dataProtection = query[kSecUseDataProtectionKeychain] as? Bool
            accessGroup = query[kSecAttrAccessGroup] as? String
        }
    }
    struct State: Sendable {
        var updates: [OSStatus]
        var calls: [String] = []
        var queries: [Query] = []
        var data = Data("old".utf8)
        var origin = "https://old.example"
    }
    let state: Mutex<State>
    let addStatus: OSStatus

    init(updates: [OSStatus], addStatus: OSStatus = errSecSuccess) {
        state = Mutex(State(updates: updates))
        self.addStatus = addStatus
    }

    func update(_ query: [CFString: Any], attributes: [CFString: Any]) -> OSStatus {
        let query = Query(query)
        let data = attributes[kSecValueData] as! Data
        let origin = attributes[kSecAttrComment] as! String
        return state.withLock {
            $0.calls.append("update")
            $0.queries.append(query)
            let status = $0.updates.removeFirst()
            if status == errSecSuccess {
                $0.data = data
                $0.origin = origin
            }
            return status
        }
    }
    func add(_ attributes: [CFString: Any]) -> OSStatus {
        let query = Query(attributes)
        state.withLock {
            $0.calls.append("add")
            $0.queries.append(query)
        }
        return addStatus
    }
    func copy(_ query: [CFString: Any]) -> (OSStatus, [String: Any]?) {
        let query = Query(query)
        let (data, origin) = state.withLock {
            $0.calls.append("copy")
            $0.queries.append(query)
            return ($0.data, $0.origin)
        }
        return (errSecSuccess, [kSecValueData as String: data, kSecAttrComment as String: origin])
    }
    func delete(_ query: [CFString: Any]) -> OSStatus {
        let query = Query(query)
        state.withLock {
            $0.calls.append("delete")
            $0.queries.append(query)
        }
        return errSecSuccess
    }
}

struct KeychainSecretStoreTests {
    @Test func failedReplacementPreservesTheStoredSecret() throws {
        let client = RecordingKeychain(updates: [errSecInteractionNotAllowed])
        let store = KeychainSecretStore(service: "test", accessGroup: nil, client: client)
        #expect(throws: SecretError.keychain(errSecInteractionNotAllowed)) {
            try store.set("new", connectionId: "c1", origin: "https://new.example")
        }
        #expect(try store.secret(connectionId: "c1", origin: "https://old.example") == "old")
        #expect(client.state.withLock { $0.calls } == ["update", "copy"])
    }

    @Test func retriesUpdateWhenAnotherWriterAddsTheItem() throws {
        let client = RecordingKeychain(updates: [errSecItemNotFound, errSecSuccess], addStatus: errSecDuplicateItem)
        let store = KeychainSecretStore(service: "test", accessGroup: nil, client: client)
        try store.set("new", connectionId: "c1", origin: "https://new.example")
        #expect(try store.secret(connectionId: "c1", origin: "https://new.example") == "new")
        #expect(client.state.withLock { $0.calls } == ["update", "add", "update", "copy"])
    }

    @Test func allOperationsUseTheDataProtectionKeychain() throws {
        let client = RecordingKeychain(updates: [errSecItemNotFound])
        let store = KeychainSecretStore(service: "test", accessGroup: "shared", client: client)
        try store.set("new", connectionId: "c1", origin: "https://new.example")
        _ = try store.has(connectionId: "c1")
        try store.delete(connectionId: "c1")
        let flags = client.state.withLock { $0.queries.map { ($0.dataProtection, $0.accessGroup) } }
        #expect(flags.count == 4)
        for (protection, group) in flags {
            #expect(protection == true)
            #expect(group == "shared")
        }
    }
}
