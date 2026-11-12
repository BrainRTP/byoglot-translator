import Foundation

public enum JSONValue: Codable, Hashable, Sendable {
    case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null

    public init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let value = try? c.decode(Bool.self) { self = .bool(value) }
        else if let value = try? c.decode(String.self) { self = .string(value) }
        else if let value = try? c.decode(Double.self) { self = .number(value) }
        else if let value = try? c.decode([String: JSONValue].self) { self = .object(value) }
        else { self = .array(try c.decode([JSONValue].self)) }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let value): try c.encode(value)
        case .number(let value): try c.encode(value)
        case .bool(let value): try c.encode(value)
        case .object(let value): try c.encode(value)
        case .array(let value): try c.encode(value)
        case .null: try c.encodeNil()
        }
    }
}

public enum ProviderEffort: Sendable {
    public static func variants(preset: ProviderPreset, supportedLevels: [String]?, supportedParameters: [String]?) -> [String] {
        if preset == .deepseek { return ["none"] + (supportedLevels ?? []) }
        if preset == .openrouter, supportedParameters?.contains("reasoning") == true {
            return ["none", "low", "medium", "high"]
        }
        return ["none"]
    }

    public static func params(preset: ProviderPreset, variant: String?) -> [String: JSONValue] {
        if preset == .deepseek { return ["reasoning_effort": .string(variant ?? "none")] }
        if preset == .openrouter, let variant, variant != "none" {
            return ["reasoning": .object(["effort": .string(variant)])]
        }
        return [:]
    }

    public static func needsKey(preset: ProviderPreset, baseUrl: String) -> Bool {
        if preset == .custom, let url = URL(string: baseUrl),
           ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
           let host = url.host?.lowercased(), ["localhost", "127.0.0.1"].contains(host) {
            return false
        }
        return Contracts.presets[preset]!.needsKey
    }
}
