import ByoGlotAppKit
import ByoGlotCore
import Foundation
import Testing

@Test func importReaderCoordinatesABoundedValidFile() async throws {
    let url = FileManager.default.temporaryDirectory.appending(path: "byoglot-import-\(UUID()).json")
    defer { try? FileManager.default.removeItem(at: url) }
    let file = SettingsLogic.export(.initial(preferredLanguage: "en"), now: Date(timeIntervalSince1970: 0))
    var data = try JSONEncoder().encode(file)
    data.append(Data(repeating: 32, count: SettingsImportReader.maximumBytes - data.count))
    try data.write(to: url)
    #expect(try await SettingsImportReader.read(url) == file)
}

@Test func importReaderRejectsOversizedFilesBeforeParsing() async throws {
    let url = FileManager.default.temporaryDirectory.appending(path: "byoglot-import-\(UUID()).json")
    defer { try? FileManager.default.removeItem(at: url) }
    try Data(repeating: 0, count: SettingsImportReader.maximumBytes + 1).write(to: url)
    await #expect(throws: SettingsImportError.tooLarge) { try await SettingsImportReader.read(url) }
}
