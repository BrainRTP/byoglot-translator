import Foundation

enum BridgeError: String, Error, Codable, Sendable {
    case badRequest = "bad_request"
    case unsupportedVersion = "unsupported_version"
    case originMismatch = "origin_mismatch"
    case offline, timeout, aborted, keychain
}

enum BridgeRequest: Decodable, Sendable {
    case ping
    case setSecret(connectionId: String, origin: String, secret: String)
    case deleteSecret(connectionId: String)
    case hasSecret(connectionId: String)
    case fetch(FetchMessage)
    case cancel(id: String)

    private enum CodingKeys: CodingKey { case v, type, connectionId, origin, secret, id }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard try c.decode(Int.self, forKey: .v) == 1 else { throw BridgeError.unsupportedVersion }
        switch try c.decode(String.self, forKey: .type) {
        case "ping": self = .ping
        case "setSecret":
            self = .setSecret(connectionId: try c.decode(String.self, forKey: .connectionId),
                              origin: try c.decode(String.self, forKey: .origin),
                              secret: try c.decode(String.self, forKey: .secret))
        case "deleteSecret": self = .deleteSecret(connectionId: try c.decode(String.self, forKey: .connectionId))
        case "hasSecret": self = .hasSecret(connectionId: try c.decode(String.self, forKey: .connectionId))
        case "fetch": self = .fetch(try FetchMessage(from: decoder))
        case "cancel": self = .cancel(id: try c.decode(String.self, forKey: .id))
        default: throw BridgeError.badRequest
        }
    }
}

struct FetchMessage: Decodable, Sendable {
    let id: String
    let connectionId: String
    let method: String
    let url: String
    let headers: [String: String]
    let body: String?
    let timeoutMs: Int
}

struct BridgeReply: Codable, Sendable {
    var ok: Bool = true
    var version: Int? = nil
    var has: Bool? = nil
    var status: Int? = nil
    var headers: [String: String]? = nil
    var body: String? = nil
    var error: BridgeError? = nil

    static func failure(_ error: BridgeError) -> Self { Self(ok: false, error: error) }

    var data: Data {
        (try? JSONEncoder().encode(self)) ?? Data(#"{"ok":false,"error":"bad_request"}"#.utf8)
    }
}
