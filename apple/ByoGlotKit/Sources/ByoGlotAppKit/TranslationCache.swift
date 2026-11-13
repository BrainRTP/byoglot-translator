import ByoGlotCore
import ByoGlotStore
import CryptoKit
import Darwin
import Foundation

public struct TranslationCacheKey: Hashable, Sendable {
    public let rawValue: String

    public init(connection: Connection, request: TextRequest) throws {
        guard let origin = originOf(connection.baseUrl) else { throw RunnerError.noConnection }
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
        string(origin)
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
    private struct Metadata: Codable {
        let connectionId: String
        let byteSize: Int
        var lastUse: TimeInterval
    }
    private struct Index: Codable {
        var generation = UUID()
        var entries: [String: Metadata] = [:]
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
                try discard(key.rawValue, from: &index)
                try writeIndex(index)
                return TranslationCacheLookup(generation: index.generation)
            }
            index.entries[key.rawValue]?.lastUse = now().timeIntervalSince1970
            try evict(&index)
            try writeIndex(index)
            return TranslationCacheLookup(value: value, generation: index.generation)
        }) ?? TranslationCacheLookup()
    }

    public func store(_ value: CachedTranslation, for key: TranslationCacheKey, connectionId: String, generation: UUID?) {
        guard !Task.isCancelled, let generation, !value.text.isEmpty, Contracts.languageCodes.contains(value.targetLang),
              let data = try? JSONEncoder().encode(value), data.count <= maxEntryBytes else { return }
        try? locked {
            var index = try readIndex()
            guard !Task.isCancelled, generation == index.generation else { return }
            try write(data, to: entryURL(key.rawValue))
            index.entries[key.rawValue] = Metadata(connectionId: connectionId, byteSize: data.count, lastUse: now().timeIntervalSince1970)
            try evict(&index)
            try writeIndex(index)
        }
    }

    public func remove(connectionId: String) {
        try? locked {
            var index = try readIndex()
            index.generation = UUID()
            for key in index.entries.keys.filter({ index.entries[$0]?.connectionId == connectionId }) { try discard(key, from: &index) }
            try writeIndex(index)
        }
    }

    public func clear() {
        try? locked {
            var index = try readIndex()
            for key in Array(index.entries.keys) { try discard(key, from: &index) }
            index.generation = UUID()
            try writeIndex(index)
        }
    }

    public func statistics() -> TranslationCacheStatistics {
        (try? locked {
            var index = try readIndex()
            try evict(&index)
            try writeIndex(index)
            return TranslationCacheStatistics(count: index.entries.count, byteSize: index.entries.values.reduce(0) { $0 + $1.byteSize })
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
        guard flock(descriptor, LOCK_EX) == 0 else { throw CocoaError(.fileLocking) }
        defer { flock(descriptor, LOCK_UN) }
        return try operation()
    }

    private func readIndex() throws -> Index {
        let url = directory.appending(path: "index.json")
        var index: Index
        if files.fileExists(atPath: url.path) {
            let data = try Data(contentsOf: url)
            if let decoded = try? JSONDecoder().decode(Index.self, from: data), decoded.entries.allSatisfy({ key, value in
                key.count == 64 && key.allSatisfy { $0.isHexDigit && !$0.isUppercase } && value.byteSize >= 0 && value.byteSize <= maxEntryBytes && value.lastUse.isFinite
            }) { index = decoded }
            else { index = Index() }
        } else { index = Index() }
        for url in try files.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) where url.pathExtension == "entry" && index.entries[url.deletingPathExtension().lastPathComponent] == nil {
            try files.removeItem(at: url)
        }
        try evict(&index)
        try writeIndex(index)
        return index
    }

    private func evict(_ index: inout Index) throws {
        var bytes = index.entries.values.reduce(0) { $0 + $1.byteSize }
        for key in index.entries.keys.sorted(by: {
            let lhs = index.entries[$0]!.lastUse, rhs = index.entries[$1]!.lastUse
            return lhs == rhs ? $0 < $1 : lhs < rhs
        }) {
            guard bytes + (try JSONEncoder().encode(index).count) > maxBytes else { break }
            bytes -= index.entries[key]!.byteSize
            try discard(key, from: &index)
        }
    }

    private func discard(_ key: String, from index: inout Index) throws {
        let url = entryURL(key)
        if files.fileExists(atPath: url.path) { try files.removeItem(at: url) }
        index.entries[key] = nil
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
