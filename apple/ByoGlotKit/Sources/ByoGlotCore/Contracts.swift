import Foundation

public struct PresetInfo: Codable, Hashable, Sendable {
    public let baseUrl: String
    public let needsKey: Bool
}

public struct Limits: Codable, Hashable, Sendable {
    public let maxBlocks: Int
    public let maxChars: Int
    public let concurrency: Int
    public let generateTimeoutMs: Int
    public let maxProfileText: Int
}

public enum Contracts: Sendable {
    private struct Languages: Decodable {
        let auto: String
        let codes: [String]
        let names: [String: String]
    }

    private struct Presets: Decodable {
        let presets: [String: PresetInfo]
        let favoriteModel: ModelRef
        let selectionDefaultEffort: String
    }

    private static let languages: Languages = load("languages")
    private static let presetFile: Presets = load("presets")
    public static let autoSourceName = languages.auto
    public static let languageCodes = languages.codes
    public static let genericProfileId = "generic"
    public static let presets: [ProviderPreset: PresetInfo] = Dictionary(
        uniqueKeysWithValues: ProviderPreset.allCases.map { preset in
            guard let info = presetFile.presets[preset.rawValue] else {
                fatalError("Missing preset in presets.json: \(preset.rawValue)")
            }
            return (preset, info)
        }
    )
    public static let favoriteModel = presetFile.favoriteModel
    public static let selectionDefaultEffort = presetFile.selectionDefaultEffort
    public static let limits: Limits = load("limits")
    public static let builtinTemplate: Template = load("builtin-template")
    public static let builtinProfiles: [String: String] = {
        let folder = Bundle.module.resourceURL!.appending(path: "Resources/profiles")
        do {
            let files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
            var profiles: [String: String] = [:]
            for file in files where file.pathExtension == "md" {
                profiles[file.deletingPathExtension().lastPathComponent] = jsTrim(try String(contentsOf: file, encoding: .utf8))
            }
            guard profiles[genericProfileId] != nil else { fatalError("Missing profiles/generic.md") }
            return profiles
        } catch {
            fatalError("Cannot load profiles: \(error)")
        }
    }()

    public static func languageName(_ code: String) -> String {
        code == "auto" ? autoSourceName : languages.names[code] ?? code
    }

    private static func load<T: Decodable>(_ name: String) -> T {
        let file = "Resources/contracts/\(name).json"
        do {
            let url = Bundle.module.resourceURL!.appending(path: file)
            return try JSONDecoder().decode(T.self, from: Data(contentsOf: url))
        } catch {
            fatalError("Cannot load \(file): \(error)")
        }
    }
}
