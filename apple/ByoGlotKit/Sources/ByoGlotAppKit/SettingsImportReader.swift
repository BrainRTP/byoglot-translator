import ByoGlotCore
import Foundation

public enum SettingsImportError: Error, Sendable { case tooLarge, unreadable, invalidFile }

public enum SettingsImportReader {
    public static let maximumBytes = 1_000_000

    public static func read(_ url: URL) async throws -> ExportFile {
        try await Task.detached(priority: .userInitiated) { try coordinatedRead(url) }.value
    }

    private static func checkSize(_ url: URL) throws {
        guard let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize else { throw SettingsImportError.unreadable }
        guard size <= maximumBytes else { throw SettingsImportError.tooLarge }
    }

    private static func coordinatedRead(_ url: URL) throws -> ExportFile {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        if let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > maximumBytes { throw SettingsImportError.tooLarge }
        var error: NSError?
        var result: Result<ExportFile, any Error>?
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &error) { coordinatedURL in
            result = Result {
                try checkSize(coordinatedURL)
                let handle = try FileHandle(forReadingFrom: coordinatedURL)
                defer { try? handle.close() }
                var data = Data()
                while let chunk = try handle.read(upToCount: min(65_536, maximumBytes + 1 - data.count)), !chunk.isEmpty {
                    data.append(chunk)
                    guard data.count <= maximumBytes else { throw SettingsImportError.tooLarge }
                }
                do { return try ExportFile.decode(data) }
                catch { throw SettingsImportError.invalidFile }
            }
        }
        if let error { throw error }
        guard let result else { throw SettingsImportError.unreadable }
        return try result.get()
    }
}
