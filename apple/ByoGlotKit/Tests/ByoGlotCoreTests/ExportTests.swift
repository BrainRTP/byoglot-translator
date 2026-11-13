import Foundation
import Testing
@testable import ByoGlotCore

struct ExportTests {
    func sample() throws -> ExportFile {
        try ExportFile.decode(Data(contentsOf: ContractsFolder.url.appending(path: "samples/export-v1.json")))
    }

    @Test func decodesTheContractSample() throws {
        let file = try sample()
        let encoded = try JSONEncoder().encode(file)
        #expect(try ExportFile.decode(encoded) == file)
        #expect(try JSONDecoder().decode(ExportFile.self, from: encoded) == file)
        let state = SettingsLogic.merge(file, into: .initial(preferredLanguage: "ru"))
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions.insert(.withFractionalSeconds)
        #expect(SettingsLogic.export(state, now: try #require(formatter.date(from: file.exportedAt))) == file)
    }

    @Test(arguments: [ProviderPreset.openai, .mistral])
    func importsNewProviderPresets(preset: ProviderPreset) throws {
        var file = try sample()
        file.connections = [ExportConnection(id: "new-provider", preset: preset, name: preset.rawValue, baseUrl: Contracts.presets[preset]!.baseUrl)]
        let decoded = try ExportFile.decode(JSONEncoder().encode(file))
        let state = SettingsLogic.merge(decoded, into: .initial(preferredLanguage: "en"))
        #expect(state.connections.first?.preset == preset)
        #expect(state.connections.first?.baseUrl == file.connections.first?.baseUrl)
    }

    @Test func rejectsAnotherFormatAndVersion() throws {
        var file = try sample()
        file.format = "other"
        #expect(throws: DecodingError.self) { try ExportFile.decode(JSONEncoder().encode(file)) }
        file.format = "byoglot-export"
        file.version = 2
        #expect(throws: DecodingError.self) { try ExportFile.decode(JSONEncoder().encode(file)) }
        file.version = 1
        file.exportedAt = "2026-02-30T00:00:00.000Z"
        #expect(throws: DecodingError.self) { try ExportFile.decode(JSONEncoder().encode(file)) }
    }

    @Test func exportCarriesNoSecretFields() throws {
        var state = AppSettings.initial(preferredLanguage: "en")
        state.connections = [Connection(id: "c1", preset: .deepseek, name: "DeepSeek", baseUrl: "https://api.deepseek.com", selectionModel: ModelRef(providerID: "deepseek", id: "deepseek-flash"))]
        state.activeConnectionId = "c1"
        state.consentedOrigins = ["https://api.deepseek.com"]
        let file = SettingsLogic.export(state, now: Date(timeIntervalSince1970: 0))
        let data = try JSONEncoder().encode(file)
        let raw = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let connections = try #require(raw["connections"] as? [[String: Any]])
        #expect(Set(try #require(connections.first).keys) == Set(["id", "preset", "name", "baseUrl"]))
        #expect(raw["consentedOrigins"] == nil)
        #expect(raw["activeConnectionId"] == nil)
        #expect(try ExportFile.decode(data) == file)
    }

    @Test func mergeDropsModelsOfUnknownConnections() throws {
        var file = try sample()
        let known = ModelRef(providerID: "deepseek", id: "deepseek-flash", variant: "none", connectionId: "c1")
        let unknown = ModelRef(providerID: "custom", id: "gone", connectionId: "missing")
        let orphan = Template(id: "orphan", name: "Orphan", builtin: false, settings: TemplateSettings(prePrompt: "keep", pageModel: known, selectionModel: unknown))
        file.templates.append(orphan)
        var state = AppSettings.initial(preferredLanguage: "en")
        state.profileOverrides["de"] = ProfileOverride(text: "local", base: "base", savedAt: 1)
        state.siteRules = [SiteRule(id: "r1", pattern: "old", templateId: "old"), SiteRule(id: "local", pattern: "local", templateId: "local")]
        let merged = SettingsLogic.merge(file, into: state)
        let imported = try #require(merged.templates.first { $0.id == "orphan" })
        #expect(imported.settings.pageModel == known)
        #expect(imported.settings.selectionModel == nil)
        #expect(imported.settings.prePrompt == "keep")
        #expect(merged.connections.map(\.id) == ["c1"])
        #expect(merged.globals == file.globals)
        #expect(merged.profileOverrides["de"] == state.profileOverrides["de"])
        #expect(merged.profileOverrides["ru"] == file.profileOverrides["ru"])
        #expect(merged.siteRules == file.siteRules + [state.siteRules[1]])
        var existing = state
        existing.connections = [Connection(id: "c1", preset: .custom, name: "Local", baseUrl: "https://local.example")]
        #expect(SettingsLogic.merge(file, into: existing).connections == existing.connections)
        file.connections = []
        let missing = SettingsLogic.merge(file, into: state)
        let study = try #require(missing.templates.first { $0.id == "study" })
        #expect(study.settings.selectionModel == nil)
        #expect(study.settings.targetLang == "de")
        #expect(study.settings.displayMode == .bilingual)
    }

    @Test func mergeKeepsOneBuiltinTemplate() throws {
        var file = try sample()
        file.templates.append(Contracts.builtinTemplate)
        var state = AppSettings.initial(preferredLanguage: "en")
        state.templates.append(Contracts.builtinTemplate)
        let merged = SettingsLogic.merge(file, into: state)
        let twice = SettingsLogic.merge(file, into: merged)
        #expect(twice.templates.filter { $0.id == Contracts.builtinTemplate.id }.count == 1)
        #expect(twice.templates == merged.templates)
    }

    @Test func pickInitialModelsPrefersTheFavorite() {
        let favorite = ModelInfo(providerID: "deepseek", id: "deepseek-flash", name: "Favorite", variants: ["none", "high"], contextLimit: 0, outputLimit: 0)
        let other = ModelInfo(providerID: "custom", id: "other", name: "Other", variants: ["low"], contextLimit: 0, outputLimit: 0)
        let pair = SettingsLogic.pickInitialModels(models: [other, favorite], defaultModel: other, connectionId: "c1")
        #expect(pair.page == ModelRef(providerID: "deepseek", id: "deepseek-flash", variant: "none", connectionId: "c1"))
        #expect(pair.selection == ModelRef(providerID: "deepseek", id: "deepseek-flash", variant: "high", connectionId: "c1"))
    }

    @Test func pickInitialModelsFallsBackToTheDefault() {
        let model = ModelInfo(providerID: "custom", id: "model", name: "Model", variants: ["low"], contextLimit: 0, outputLimit: 0)
        let pair = SettingsLogic.pickInitialModels(models: [model], defaultModel: model, connectionId: "c1")
        let expected = ModelRef(providerID: "custom", id: "model", variant: "low", connectionId: "c1")
        #expect(pair.page == expected)
        #expect(pair.selection == expected)
        let missing = SettingsLogic.pickInitialModels(models: [model], defaultModel: nil, connectionId: "c1")
        #expect(missing.page == nil)
        #expect(missing.selection == nil)
    }

    @Test func effectiveUsesOnlyTheActiveConnectionsModel() {
        var state = AppSettings.initial(preferredLanguage: "ru-RU")
        let connectionModel = ModelRef(providerID: "custom", id: "base", connectionId: "c1")
        let templateModel = ModelRef(providerID: "custom", id: "template", connectionId: "c1")
        state.connections = [Connection(id: "c1", preset: .custom, name: "Local", baseUrl: "http://localhost", selectionModel: connectionModel)]
        state.activeConnectionId = "c1"
        var template = Template(id: "t1", name: "T", builtin: false, settings: TemplateSettings(prePrompt: "rules", targetLang: "de", selectionModel: templateModel))
        let own = SettingsLogic.effective(template: template, settings: state)
        #expect(own.prePrompt == "rules")
        #expect(own.targetLang == "de")
        #expect(own.model == templateModel)
        template.settings.selectionModel?.connectionId = "c2"
        state.connections.append(Connection(id: "c2", preset: .custom, name: "Other", baseUrl: "http://localhost:8080", selectionModel: template.settings.selectionModel))
        state.externalModel = template.settings.selectionModel
        template.settings.targetLang = nil
        #expect(SettingsLogic.effective(template: template, settings: state).model == connectionModel)
        #expect(SettingsLogic.effectiveForApp(template: template, settings: state).model == template.settings.selectionModel)
        #expect(SettingsLogic.effective(template: template, settings: state).targetLang == "ru")
        state.activeConnectionId = nil
        template.settings.selectionModel?.connectionId = nil
        #expect(SettingsLogic.effective(template: template, settings: state).model == nil)
    }

    @Test(arguments: ["root", "globals", "template", "settings", "model", "profile", "siteRule", "connection"])
    func rejectsUnknownPortableKeys(_ location: String) throws {
        var raw = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(sample())) as? [String: Any])
        switch location {
        case "root": raw["apiKey"] = "unexpected"
        case "globals":
            var globals = raw["globals"] as! [String: Any]
            globals["apiKey"] = "unexpected"
            raw["globals"] = globals
        case "template", "settings", "model":
            var templates = raw["templates"] as! [[String: Any]]
            if location == "template" { templates[1]["apiKey"] = "unexpected" }
            else {
                var settings = templates[1]["settings"] as! [String: Any]
                if location == "settings" { settings["apiKey"] = "unexpected" }
                else {
                    var model = settings["selectionModel"] as! [String: Any]
                    model["apiKey"] = "unexpected"
                    settings["selectionModel"] = model
                }
                templates[1]["settings"] = settings
            }
            raw["templates"] = templates
        case "profile":
            var profiles = raw["profileOverrides"] as! [String: [String: Any]]
            profiles["ru"]!["apiKey"] = "unexpected"
            raw["profileOverrides"] = profiles
        case "siteRule":
            var rules = raw["siteRules"] as! [[String: Any]]
            rules[0]["apiKey"] = "unexpected"
            raw["siteRules"] = rules
        default:
            var connections = raw["connections"] as! [[String: Any]]
            connections[0]["apiKey"] = "unexpected"
            raw["connections"] = connections
        }
        #expect(throws: DecodingError.self) { try ExportFile.decode(JSONSerialization.data(withJSONObject: raw)) }
    }
}
