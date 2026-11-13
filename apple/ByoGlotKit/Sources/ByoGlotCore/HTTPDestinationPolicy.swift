import Foundation

enum HTTPDestinationPolicy {
    static func permits(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased(), !host.isEmpty else { return false }
        if scheme == "https" { return true }
        return scheme == "http" && isLocalOrLAN(host)
    }

    private static func isLocalOrLAN(_ rawHost: String) -> Bool {
        let host = rawHost.hasSuffix(".") ? String(rawHost.dropLast()) : rawHost
        if host == "localhost" || host.hasSuffix(".local") { return true }
        if let bytes = ipv4(host) { return localIPv4(bytes) }
        let literal = host.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        let address = String(literal.prefix { $0 != "%" })
        guard let words = ipv6(address) else { return false }
        if words.dropLast().allSatisfy({ $0 == 0 }), words.last == 1 { return true }
        if words[0] & 0xfe00 == 0xfc00 || words[0] & 0xffc0 == 0xfe80 { return true }
        if words.prefix(5).allSatisfy({ $0 == 0 }), words[5] == 0xffff {
            return localIPv4([UInt8(words[6] >> 8), UInt8(words[6] & 255), UInt8(words[7] >> 8), UInt8(words[7] & 255)])
        }
        return false
    }

    private static func localIPv4(_ bytes: [UInt8]) -> Bool {
        bytes[0] == 127 || bytes[0] == 10
            || (bytes[0] == 172 && (16...31).contains(bytes[1]))
            || (bytes[0] == 192 && bytes[1] == 168)
            || (bytes[0] == 169 && bytes[1] == 254)
    }

    private static func ipv4(_ text: String) -> [UInt8]? {
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return nil }
        var bytes: [UInt8] = []
        for part in parts {
            guard !part.isEmpty, part.utf8.allSatisfy({ (48...57).contains($0) }),
                  part.utf8.count == 1 || part.first != "0", let value = UInt8(part) else { return nil }
            bytes.append(value)
        }
        return bytes
    }

    private static func ipv6(_ text: String) -> [UInt16]? {
        let halves = text.components(separatedBy: "::")
        guard halves.count <= 2 else { return nil }
        func words(_ half: String) -> [UInt16]? {
            if half.isEmpty { return [] }
            let parts = half.split(separator: ":", omittingEmptySubsequences: false)
            var result: [UInt16] = []
            for (index, part) in parts.enumerated() {
                if part.contains("."), index == parts.count - 1, let bytes = ipv4(String(part)) {
                    result.append(UInt16(bytes[0]) << 8 | UInt16(bytes[1]))
                    result.append(UInt16(bytes[2]) << 8 | UInt16(bytes[3]))
                } else {
                    guard !part.isEmpty, part.utf8.count <= 4,
                          part.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
                          let value = UInt16(part, radix: 16) else { return nil }
                    result.append(value)
                }
            }
            return result
        }
        guard let left = words(halves[0]) else { return nil }
        if halves.count == 1 { return left.count == 8 ? left : nil }
        guard let right = words(halves[1]), left.count + right.count < 8 else { return nil }
        return left + Array(repeating: 0, count: 8 - left.count - right.count) + right
    }
}
