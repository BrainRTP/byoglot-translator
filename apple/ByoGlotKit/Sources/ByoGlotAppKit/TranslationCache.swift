import ByoGlotCore
import ByoGlotStore
import CryptoKit
import Darwin
import Foundation

public struct TranslationCacheKey: Hashable, Sendable {
    public let rawValue: String

    public init(connection: Connection, request: TextRequest) throws {
        guard let origin = originOf(connection.baseUrl), let url = URLComponents(string: connection.baseUrl) else { throw RunnerError.noConnection }
        var path = url.percentEncodedPath
        while path.hasSuffix("/") { path.removeLast() }
        let prompt = PromptBuilder.text(TextPromptInput(prePrompt: request.prePrompt, languagePrompt: request.languagePrompt, sourceLang: request.sourceLang, targetLang: request.targetLang, text: request.text, context: request.context, appName: request.appName))
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let effort = try encoder.encode(ProviderEffort.params(preset: connection.preset, variant: request.model.variant))
        var bytes = Data()
        func integer(_ value: UInt32) {
            var value = value.bigEndian
            withUnsafeBytes(of: &value) { bytes.append(contentsOf: $0) }
        }
        func string(_ value: String) {
            let utf8 = Data(value.utf8)
            integer(UInt32(utf8.count))
            bytes.append(utf8)
        }
        string("byoglot.translation-cache")
        integer(1)
        string(origin + path)
        string(request.model.id)
        string(String(decoding: effort, as: UTF8.self))
        integer(1)
        string("user")
        string(prompt)
        rawValue = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }
}

public struct CachedTranslation: Codable, Sendable, Equatable, CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    public let text: String
    public let targetLang: String
    public init(text: String, targetLang: String) { self.text = text; self.targetLang = targetLang }
    public var description: String { "CachedTranslation(textLength: \(text.utf16.count))" }
    public var debugDescription: String { description }
    public var customMirror: Mirror { Mirror(self, children: ["summary": description]) }
}

public struct TranslationCacheLookup: Sendable {
    public let value: CachedTranslation?
    public let generation: UUID?
    public init(value: CachedTranslation? = nil, generation: UUID? = nil) { self.value = value; self.generation = generation }
}

public struct TranslationCacheStatistics: Sendable, Equatable {
    public let count: Int
    public let byteSize: Int
    public init(count: Int = 0, byteSize: Int = 0) { self.count = count; self.byteSize = byteSize }
}

public protocol TranslationCaching: Sendable {
    func generation() async -> UUID?
    func lookup(_ key: TranslationCacheKey, bypass: Bool) async -> TranslationCacheLookup
    func store(_ value: CachedTranslation, for key: TranslationCacheKey, connectionId: String, generation: UUID?) async
    func remove(connectionId: String) async
    func clear() async
    func statistics() async -> TranslationCacheStatistics
}

public actor TranslationCache: TranslationCaching {
    private let directory: URL
    private let maxBytes: Int
    private let maxEntryBytes: Int
    private let now: @Sendable () -> Date
    private let files = FileManager.default
    private struct Metadata: Codable, Equatable {
        let connectionId: String
        let byteSize: Int
        var lastUse: TimeInterval
    }
    private struct Index: Codable {
        var generation = UUID()
        var entries: [String: Metadata] = [:]
        var valueBytes = 0
        var encodedBytes = 0
        var entryBytes: [String: Int] = [:]
        private enum CodingKeys: String, CodingKey { case generation, entries }

        mutating func measure() throws {
            valueBytes = 0
            encodedBytes = try JSONEncoder().encode(Index()).count
            entryBytes = [:]
            for (key, metadata) in entries {
                let bytes = key.utf8.count + 3 + (try JSONEncoder().encode(metadata).count)
                entryBytes[key] = bytes
                encodedBytes += bytes
                valueBytes += metadata.byteSize
            }
            encodedBytes += max(0, entries.count - 1)
        }

        mutating func set(_ metadata: Metadata, for key: String) throws {
            let bytes = key.utf8.count + 3 + (try JSONEncoder().encode(metadata).count)
            remove(key)
            encodedBytes += bytes + (entries.isEmpty ? 0 : 1)
            valueBytes += metadata.byteSize
            entries[key] = metadata
            entryBytes[key] = bytes
        }

        mutating func remove(_ key: String) {
            guard let metadata = entries.removeValue(forKey: key) else { return }
            valueBytes -= metadata.byteSize
            encodedBytes -= (entryBytes.removeValue(forKey: key) ?? 0) + (entries.isEmpty ? 0 : 1)
        }
    }

    public init(directory: URL, maxBytes: Int = 20_000_000, maxEntryBytes: Int = 200_000, now: @escaping @Sendable () -> Date = Date.init) {
        self.directory = directory
        self.maxBytes = max(0, maxBytes)
        self.maxEntryBytes = max(0, maxEntryBytes)
        self.now = now
    }

    public func generation() -> UUID? { try? locked { try readIndex().generation } }

    public func lookup(_ key: TranslationCacheKey, bypass: Bool = false) -> TranslationCacheLookup {
        (try? locked {
            var index = try readIndex()
            guard !bypass, let metadata = index.entries[key.rawValue] else { return TranslationCacheLookup(generation: index.generation) }
            let url = entryURL(key.rawValue)
            guard (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) == metadata.byteSize,
                  let data = try? Data(contentsOf: url), data.count == metadata.byteSize, data.count <= maxEntryBytes,
                  let value = try? JSONDecoder().decode(CachedTranslation.self, from: data), !value.text.isEmpty, Contracts.languageCodes.contains(value.targetLang) else {
                discard(key.rawValue, from: &index)
                try? writeIndex(index)
                return TranslationCacheLookup(generation: index.generation)
            }
            var updated = metadata
            updated.lastUse = now().timeIntervalSince1970
            if updated.lastUse != metadata.lastUse {
                do {
                    try index.set(updated, for: key.rawValue)
                    evict(&index)
                    try writeIndex(index)
                } catch {}
            }
            return TranslationCacheLookup(value: value, generation: index.generation)
        }) ?? TranslationCacheLookup()
    }

    public func store(_ value: CachedTranslation, for key: TranslationCacheKey, connectionId: String, generation: UUID?) {
        guard !Task.isCancelled, let generation, !value.text.isEmpty, Contracts.languageCodes.contains(value.targetLang),
              let data = try? JSONEncoder().encode(value), data.count <= maxEntryBytes else { return }
        try? locked {
            var index = try readIndex()
            guard !Task.isCancelled, generation == index.generation else { return }
            sweepOrphans(index)
            try write(data, to: entryURL(key.rawValue))
            let metadata = Metadata(connectionId: connectionId, byteSize: data.count, lastUse: now().timeIntervalSince1970)
            if index.entries[key.rawValue] != metadata {
                try index.set(metadata, for: key.rawValue)
                evict(&index)
                try writeIndex(index)
            }
        }
    }

    public func remove(connectionId: String) {
        try? locked {
            var index = try readIndex()
            index.generation = UUID()
            for key in index.entries.keys.filter({ index.entries[$0]?.connectionId == connectionId }) { discard(key, from: &index) }
            try writeIndex(index)
        }
    }

    public func clear() {
        try? locked {
            var index = try readIndex()
            for key in Array(index.entries.keys) { discard(key, from: &index) }
            index.generation = UUID()
            sweepOrphans(index)
            try writeIndex(index)
        }
    }

    public func statistics() -> TranslationCacheStatistics {
        (try? locked {
            let index = try readIndex()
            return TranslationCacheStatistics(count: index.entries.count, byteSize: index.valueBytes)
        }) ?? TranslationCacheStatistics()
    }

    private func locked<T>(_ operation: () throws -> T) throws -> T {
        var attributes: [FileAttributeKey: Any] = [:]
        #if os(iOS)
        attributes[.protectionKey] = FileProtectionType.completeUntilFirstUserAuthentication
        #endif
        try files.createDirectory(at: directory, withIntermediateDirectories: true, attributes: attributes)
        try protect(directory)
        let lockURL = directory.appending(path: "cache.lock")
        let descriptor = open(lockURL.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw CocoaError(.fileWriteUnknown) }
        defer { close(descriptor) }
        try protect(lockURL)
        var acquired = false
        for attempt in 0..<4 {
            guard !Task.isCancelled else { throw CancellationError() }
            if flock(descriptor, LOCK_EX | LOCK_NB) == 0 { acquired = true; break }
            guard errno == EWOULDBLOCK || errno == EINTR else { throw CocoaError(.fileLocking) }
            if attempt < 3 { usleep(5_000) }
        }
        guard acquired else { throw CocoaError(.fileLocking) }
        defer { flock(descriptor, LOCK_UN) }
        return try operation()
    }

    private func readIndex() throws -> Index {
        let url = directory.appending(path: "index.json")
        var index: Index
        var changed = false
        if files.fileExists(atPath: url.path) {
            let data = try Data(contentsOf: url)
            if let decoded = try? JSONDecoder().decode(Index.self, from: data), decoded.entries.allSatisfy({ key, value in
                key.count == 64 && key.allSatisfy { $0.isHexDigit && !$0.isUppercase } && value.byteSize >= 0 && value.byteSize <= maxEntryBytes && value.lastUse.isFinite
            }) { index = decoded }
            else { index = Index(); changed = true }
        } else { index = Index(); changed = true }
        try index.measure()
        if evict(&index) { changed = true }
        if changed { try writeIndex(index) }
        return index
    }

    @discardableResult private func evict(_ index: inout Index) -> Bool {
        guard index.valueBytes + index.encodedBytes > maxBytes else { return false }
        var changed = false
        for key in index.entries.keys.sorted(by: {
            let lhs = index.entries[$0]!.lastUse, rhs = index.entries[$1]!.lastUse
            return lhs == rhs ? $0 < $1 : lhs < rhs
        }) {
            guard index.valueBytes + index.encodedBytes > maxBytes else { break }
            discard(key, from: &index)
            changed = true
        }
        return changed
    }

    private func discard(_ key: String, from index: inout Index) {
        try? files.removeItem(at: entryURL(key))
        index.remove(key)
    }

    private func sweepOrphans(_ index: Index) {
        guard let urls = try? files.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        for url in urls where url.pathExtension == "entry" && index.entries[url.deletingPathExtension().lastPathComponent] == nil {
            try? files.removeItem(at: url)
        }
    }

    private func entryURL(_ key: String) -> URL { directory.appending(path: key + ".entry") }
    private func writeIndex(_ index: Index) throws { try write(JSONEncoder().encode(index), to: directory.appending(path: "index.json")) }
    private func write(_ data: Data, to url: URL) throws {
        #if os(iOS)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: url, options: .atomic)
        #endif
        try protect(url)
    }
    private func protect(_ url: URL) throws {
        #if os(iOS)
        try files.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
        #endif
        var url = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try url.setResourceValues(values)
    }
}
