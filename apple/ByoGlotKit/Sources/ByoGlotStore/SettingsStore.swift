import ByoGlotCore
import Darwin
import Foundation

public actor SettingsStore {
    private let directory: URL
    private var file: URL { directory.appending(path: "settings.json") }

    public init(directory: URL) { self.directory = directory }

    public func read() throws -> AppSettings {
        try withFileLock { try readOrCreate() }
    }

    public func update(_ change: @Sendable (inout AppSettings) -> Void) throws -> AppSettings {
        try withFileLock {
            var settings = try readOrCreate()
            let revision = settings.revision
            change(&settings)
            settings.revision = revision + 1
            try write(settings)
            return settings
        }
    }

    private func readOrCreate() throws -> AppSettings {
        if FileManager.default.fileExists(atPath: file.path) {
            return try JSONDecoder().decode(AppSettings.self, from: Data(contentsOf: file))
        }
        let settings = AppSettings.initial(preferredLanguage: Locale.preferredLanguages.first)
        try write(settings)
        return settings
    }

    private func write(_ settings: AppSettings) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]
        var data = try encoder.encode(settings)
        data.append(0x0a)
        try data.write(to: file, options: .atomic)
    }

    private func withFileLock<T>(_ operation: () throws -> T) throws -> T {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        // Lock a stable sibling because atomic writes replace the settings inode.
        let descriptor = open(directory.appending(path: "settings.lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        defer { close(descriptor) }
        while flock(descriptor, LOCK_EX) != 0 {
            if errno != EINTR { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        }
        defer { flock(descriptor, LOCK_UN) }
        return try operation()
    }
}
