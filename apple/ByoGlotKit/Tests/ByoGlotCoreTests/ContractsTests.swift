import Foundation
import Testing
@testable import ByoGlotCore

struct ContractsTests {
    struct LanguagesFile: Decodable {
        let auto: String
        let codes: [String]
        let names: [String: String]
    }
    struct ErrorsFile: Decodable {
        let kinds: [String]
        let fatal: [String]
    }

    @Test func languagesMatchTheContract() throws {
        let file = try JSONDecoder().decode(LanguagesFile.self, from: Data(contentsOf: ContractsFolder.url.appending(path: "languages.json")))
        #expect(Contracts.languageCodes == file.codes)
        for (code, name) in file.names { #expect(Contracts.languageName(code) == name) }
        #expect(Contracts.languageName("ru") == "Russian")
        #expect(Contracts.languageName("auto") == file.auto)
        #expect(Contracts.languageName("not a code") == "not a code")
    }

    @Test func limitsAndPresets() throws {
        #expect(Contracts.limits.maxChars == 4000)
        #expect(Contracts.limits.generateTimeoutMs == 180_000)
        #expect(Contracts.presets[.deepseek]?.baseUrl == "https://api.deepseek.com")
        #expect(Contracts.presets[.ollama]?.needsKey == false)
        #expect(Contracts.favoriteModel.id == "deepseek-flash")
        let limits = try JSONDecoder().decode(Limits.self, from: Data(contentsOf: ContractsFolder.url.appending(path: "limits.json")))
        #expect(Contracts.limits == limits)
        struct PresetsFile: Decodable {
            let presets: [String: PresetInfo]
            let favoriteModel: ModelRef
            let selectionDefaultEffort: String
        }
        let file = try JSONDecoder().decode(PresetsFile.self, from: Data(contentsOf: ContractsFolder.url.appending(path: "presets.json")))
        for preset in ProviderPreset.allCases { #expect(Contracts.presets[preset] == file.presets[preset.rawValue]) }
        #expect(Contracts.favoriteModel == file.favoriteModel)
        #expect(Contracts.selectionDefaultEffort == file.selectionDefaultEffort)
        let builtin = try JSONDecoder().decode(Template.self, from: Data(contentsOf: ContractsFolder.url.appending(path: "builtin-template.json")))
        #expect(Contracts.builtinTemplate == builtin)
    }

    @Test func profilesAreBundledAndTrimmed() throws {
        #expect(Contracts.builtinProfiles["generic"]?.isEmpty == false)
        #expect(Contracts.builtinProfiles["ru"]?.hasSuffix("\n") == false)
        let root = ContractsFolder.url.deletingLastPathComponent().appending(path: "lib/translate/profiles")
        for (code, text) in Contracts.builtinProfiles {
            let source = try String(contentsOf: root.appending(path: "\(code).md"), encoding: .utf8)
            #expect(text == source.trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }

    @Test func errorKindsMatchTheContract() throws {
        let file = try JSONDecoder().decode(ErrorsFile.self, from: Data(contentsOf: ContractsFolder.url.appending(path: "errors.json")))
        #expect(BackendError.Kind.allCases.map(\.rawValue) == file.kinds)
        #expect(BackendError.Kind.allCases.filter { BackendError(kind: $0).isFatal }.map(\.rawValue) == file.fatal)
    }
}
