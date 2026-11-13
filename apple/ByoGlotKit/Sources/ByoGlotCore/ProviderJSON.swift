import Foundation

func providerJSON(_ data: Data) throws -> Data {
    _ = try JSONDecoder().decode(JSONValue.self, from: data)
    var parser = ProviderJSONParser(bytes: Array(data))
    return Data(try parser.document())
}

private struct ProviderJSONParser {
    let bytes: [UInt8]
    var index = 0
    enum Invalid: Error { case json }

    mutating func document() throws -> [UInt8] {
        if bytes.starts(with: [0xef, 0xbb, 0xbf]) { index = 3 }
        let result = try value()
        whitespace()
        guard index == bytes.count else { throw Invalid.json }
        return result
    }

    mutating func value() throws -> [UInt8] {
        whitespace()
        guard index < bytes.count else { throw Invalid.json }
        switch bytes[index] {
        case 123: return try container(object: true)
        case 91: return try container(object: false)
        case 34: return try string()
        default:
            let start = index
            while index < bytes.count, ![9, 10, 13, 32, 44, 93, 125].contains(bytes[index]) { index += 1 }
            guard index > start else { throw Invalid.json }
            return Array(bytes[start..<index])
        }
    }

    private mutating func container(object: Bool) throws -> [UInt8] {
        let open: UInt8 = object ? 123 : 91
        let close: UInt8 = object ? 125 : 93
        index += 1
        var members: [[UInt8]] = []
        if !consume(close) {
            repeat {
                var member: [UInt8] = []
                if object {
                    member = try string()
                    guard consume(58) else { throw Invalid.json }
                    member.append(58)
                }
                member += try value()
                members.append(member)
                if consume(close) { break }
                guard consume(44) else { throw Invalid.json }
            } while true
        }
        // Foundation keeps the first key; reverse members to keep the last original value.
        if object { members.reverse() }
        var result: [UInt8] = [open]
        for (offset, member) in members.enumerated() {
            if offset > 0 { result.append(44) }
            result += member
        }
        return result + [close]
    }

    private mutating func string() throws -> [UInt8] {
        whitespace()
        let start = index
        guard consume(34) else { throw Invalid.json }
        while index < bytes.count {
            let byte = bytes[index]
            index += 1
            if byte == 34 { return Array(bytes[start..<index]) }
            if byte == 92 { index += 1 }
        }
        throw Invalid.json
    }

    private mutating func consume(_ byte: UInt8) -> Bool {
        whitespace()
        guard index < bytes.count, bytes[index] == byte else { return false }
        index += 1
        return true
    }

    private mutating func whitespace() {
        while index < bytes.count, [9, 10, 13, 32].contains(bytes[index]) { index += 1 }
    }
}
