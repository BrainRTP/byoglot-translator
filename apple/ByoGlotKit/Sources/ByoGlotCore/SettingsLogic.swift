import Foundation

public struct AppSettings: Codable, Hashable, Sendable {
    public var schemaVersion: Int
    public var revision: Int
    public var globals: PortableGlobals
    public var templates: [Template]
    public var profileOverrides: [String: ProfileOverride]
    public var siteRules: [SiteRule]
    public var connections: [Connection]
    public var activeConnectionId: String?
    public var consentedOrigins: [String]

    public init(schemaVersion: Int = 1, revision: Int = 0, globals: PortableGlobals, templates: [Template], profileOverrides: [String: ProfileOverride] = [:], siteRules: [SiteRule] = [], connections: [Connection] = [], activeConnectionId: String? = nil, consentedOrigins: [String] = []) {
        self.schemaVersion = schemaVersion
        self.revision = revision
        self.globals = globals
        self.templates = templates
        self.profileOverrides = profileOverrides
        self.siteRules = siteRules
        self.connections = connections
        self.activeConnectionId = activeConnectionId
        self.consentedOrigins = consentedOrigins
    }

    public static func initial(preferredLanguage: String?) -> AppSettings {
        let primary = LanguageProfiles.primaryLang(preferredLanguage ?? "en")
        let target = Contracts.languageCodes.contains(primary) ? primary : "en"
        return AppSettings(globals: PortableGlobals(sourceLang: "auto", targetLang: target, languagePromptEnabled: true, languageProfile: "auto", defaultTemplateId: Contracts.builtinTemplate.id), templates: [Contracts.builtinTemplate])
    }

    private enum CodingKeys: CodingKey {
        case schemaVersion, revision, globals, templates, profileOverrides, siteRules, connections, activeConnectionId, consentedOrigins
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try c.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        revision = try c.decodeIfPresent(Int.self, forKey: .revision) ?? 0
        globals = try c.decode(PortableGlobals.self, forKey: .globals)
        templates = try c.decode([Template].self, forKey: .templates)
        profileOverrides = try c.decodeIfPresent([String: ProfileOverride].self, forKey: .profileOverrides) ?? [:]
        siteRules = try c.decodeIfPresent([SiteRule].self, forKey: .siteRules) ?? []
        connections = try c.decodeIfPresent([Connection].self, forKey: .connections) ?? []
        activeConnectionId = try c.decodeIfPresent(String.self, forKey: .activeConnectionId)
        consentedOrigins = try c.decodeIfPresent([String].self, forKey: .consentedOrigins) ?? []
    }
}

public enum SettingsLogic: Sendable {
    public static func export(_ s: AppSettings, now: Date) -> ExportFile {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return ExportFile(format: "byoglot-export", version: 1, exportedAt: formatter.string(from: now), globals: s.globals, templates: s.templates, profileOverrides: s.profileOverrides, siteRules: s.siteRules, connections: s.connections.map { ExportConnection(id: $0.id, preset: $0.preset, name: $0.name, baseUrl: $0.baseUrl) })
    }

    public static func merge(_ file: ExportFile, into s: AppSettings) -> AppSettings {
        var result = s
        result.globals = file.globals
        result.templates = mergeById(s.templates, file.templates, id: { $0.id })
        result.profileOverrides.merge(file.profileOverrides) { _, imported in imported }
        result.siteRules = mergeById(s.siteRules, file.siteRules, id: { $0.id })
        var ids = Set(result.connections.map(\.id))
        for connection in file.connections where ids.insert(connection.id).inserted {
            result.connections.append(Connection(id: connection.id, preset: connection.preset, name: connection.name, baseUrl: connection.baseUrl))
        }
        func valid(_ ref: ModelRef?) -> ModelRef? {
            guard let ref, let id = ref.connectionId, ids.contains(id) else { return nil }
            return ref
        }
        for index in result.templates.indices {
            result.templates[index].settings.pageModel = valid(result.templates[index].settings.pageModel)
            result.templates[index].settings.selectionModel = valid(result.templates[index].settings.selectionModel)
        }
        return result
    }

    public static func effective(template: Template, settings: AppSettings) -> (prePrompt: String, targetLang: String, model: ModelRef?) {
        let active = settings.connections.first { $0.id == settings.activeConnectionId }
        let model: ModelRef?
        if let id = settings.activeConnectionId, let ref = template.settings.selectionModel, ref.connectionId == id {
            model = ref
        } else { model = active?.selectionModel }
        return (template.settings.prePrompt ?? "", template.settings.targetLang ?? settings.globals.targetLang, model)
    }

    public static func pickInitialModels(models: [ModelInfo], defaultModel: ModelInfo?, connectionId: String) -> (page: ModelRef?, selection: ModelRef?) {
        func pair(_ model: ModelInfo, variant: String?) -> (page: ModelRef?, selection: ModelRef?) {
            let selection = model.variants.contains(Contracts.selectionDefaultEffort) ? Contracts.selectionDefaultEffort : variant
            return (
                ModelRef(providerID: model.providerID, id: model.id, variant: variant, connectionId: connectionId),
                ModelRef(providerID: model.providerID, id: model.id, variant: selection, connectionId: connectionId)
            )
        }
        if let favorite = models.first(where: { $0.providerID == Contracts.favoriteModel.providerID && $0.id == Contracts.favoriteModel.id }) {
            return pair(favorite, variant: favorite.variants.contains("none") ? "none" : nil)
        }
        guard let model = defaultModel else { return (nil, nil) }
        return pair(model, variant: model.variants.contains("none") ? "none" : model.variants.first)
    }

    private static func mergeById<T>(_ stored: [T], _ imported: [T], id: (T) -> String) -> [T] {
        var result: [T] = []
        var positions: [String: Int] = [:]
        for value in stored + imported {
            if let index = positions[id(value)] { result[index] = value }
            else {
                positions[id(value)] = result.count
                result.append(value)
            }
        }
        return result
    }
}
