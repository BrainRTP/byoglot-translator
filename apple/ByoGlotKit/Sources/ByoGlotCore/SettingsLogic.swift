import Foundation

public enum ThemeChoice: String, Codable, Hashable, Sendable { case system, light, dark }

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
    public var theme: ThemeChoice
    public var autoTranslate: Bool
    public var mainModel: ModelRef?
    public var externalModel: ModelRef?
    public var fallbackModel: ModelRef?

    public init(schemaVersion: Int = 1, revision: Int = 0, globals: PortableGlobals, templates: [Template], profileOverrides: [String: ProfileOverride] = [:], siteRules: [SiteRule] = [], connections: [Connection] = [], activeConnectionId: String? = nil, consentedOrigins: [String] = [], theme: ThemeChoice = .system, autoTranslate: Bool = true, mainModel: ModelRef? = nil, externalModel: ModelRef? = nil, fallbackModel: ModelRef? = nil) {
        self.schemaVersion = schemaVersion
        self.revision = revision
        self.globals = globals
        self.templates = templates
        self.profileOverrides = profileOverrides
        self.siteRules = siteRules
        self.connections = connections
        self.activeConnectionId = activeConnectionId
        self.consentedOrigins = consentedOrigins
        self.theme = theme
        self.autoTranslate = autoTranslate
        self.mainModel = mainModel
        self.externalModel = externalModel
        self.fallbackModel = fallbackModel
    }

    public static func initial(preferredLanguage: String?) -> AppSettings {
        let primary = LanguageProfiles.primaryLang(preferredLanguage ?? "en")
        let target = Contracts.languageCodes.contains(primary) ? primary : "en"
        return AppSettings(globals: PortableGlobals(sourceLang: "auto", targetLang: target, languagePromptEnabled: true, languageProfile: "auto", defaultTemplateId: Contracts.builtinTemplate.id), templates: [Contracts.builtinTemplate])
    }

    private enum CodingKeys: CodingKey {
        case schemaVersion, revision, globals, templates, profileOverrides, siteRules, connections, activeConnectionId, consentedOrigins, theme, autoTranslate, mainModel, externalModel, fallbackModel
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
        theme = try c.decodeIfPresent(ThemeChoice.self, forKey: .theme) ?? .system
        autoTranslate = try c.decodeIfPresent(Bool.self, forKey: .autoTranslate) ?? true
        mainModel = try c.decodeIfPresent(ModelRef.self, forKey: .mainModel)
        externalModel = try c.decodeIfPresent(ModelRef.self, forKey: .externalModel)
        fallbackModel = try c.decodeIfPresent(ModelRef.self, forKey: .fallbackModel)
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
        effective(template: template, settings: settings, main: false)
    }

    public static func effectiveMain(template: Template, settings: AppSettings) -> (prePrompt: String, targetLang: String, model: ModelRef?) {
        effective(template: template, settings: settings, main: true)
    }

    private static func effective(template: Template, settings: AppSettings, main: Bool) -> (prePrompt: String, targetLang: String, model: ModelRef?) {
        let own = main ? template.settings.pageModel : template.settings.selectionModel
        let model = own.map { bindModel($0, settings: settings) ?? fallbackModel(settings: settings, main: main) } ?? defaultModel(settings: settings, main: main)
        return (template.settings.prePrompt ?? "", template.settings.targetLang ?? settings.globals.targetLang, model)
    }

    public static func modelConnection(_ model: ModelRef, settings: AppSettings) -> Connection? {
        settings.connections.first { connection in
            if let id = model.connectionId { return connection.id == id }
            return connection.id == settings.activeConnectionId && connection.preset.rawValue == model.providerID
        }
    }

    public static func bindModel(_ model: ModelRef, settings: AppSettings) -> ModelRef? {
        guard let connection = modelConnection(model, settings: settings) else { return nil }
        var result = model
        result.connectionId = connection.id
        return result
    }

    public static func fallbackModel(settings: AppSettings, main: Bool) -> ModelRef? {
        settings.fallbackModel.flatMap { bindModel($0, settings: settings) } ?? defaultModel(settings: settings, main: main)
    }

    public static func defaultModel(settings: AppSettings, main: Bool) -> ModelRef? {
        let selected = main ? settings.mainModel : settings.externalModel
        if let bound = selected.flatMap({ bindModel($0, settings: settings) }) { return bound }
        guard let active = settings.connections.first(where: { $0.id == settings.activeConnectionId }) else { return nil }
        var ref = main ? active.pageModel ?? active.selectionModel : active.selectionModel
        ref?.connectionId = active.id
        return ref
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
