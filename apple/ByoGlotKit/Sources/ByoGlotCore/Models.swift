public enum ProviderPreset: String, Codable, Hashable, CaseIterable, Sendable {
    case deepseek, openrouter, ollama, lmstudio, custom
}

public enum DisplayMode: String, Codable, Hashable, Sendable {
    case replace, bilingual
}

public struct ModelRef: Codable, Hashable, Sendable {
    public var providerID: String
    public var id: String
    public var variant: String?
    public var connectionId: String?

    public init(providerID: String, id: String, variant: String? = nil, connectionId: String? = nil) {
        self.providerID = providerID
        self.id = id
        self.variant = variant
        self.connectionId = connectionId
    }
}

public struct ModelInfo: Codable, Hashable, Sendable {
    public var providerID: String
    public var id: String
    public var name: String
    public var variants: [String]
    public var contextLimit: Int
    public var outputLimit: Int

    public init(providerID: String, id: String, name: String, variants: [String], contextLimit: Int, outputLimit: Int) {
        self.providerID = providerID
        self.id = id
        self.name = name
        self.variants = variants
        self.contextLimit = contextLimit
        self.outputLimit = outputLimit
    }
}

public struct Connection: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var preset: ProviderPreset
    public var name: String
    public var baseUrl: String
    public var pageModel: ModelRef?
    public var selectionModel: ModelRef?

    public init(id: String, preset: ProviderPreset, name: String, baseUrl: String, pageModel: ModelRef? = nil, selectionModel: ModelRef? = nil) {
        self.id = id
        self.preset = preset
        self.name = name
        self.baseUrl = baseUrl
        self.pageModel = pageModel
        self.selectionModel = selectionModel
    }
}

public struct TemplateSettings: Codable, Hashable, Sendable {
    public var prePrompt: String?
    public var targetLang: String?
    public var displayMode: DisplayMode?
    public var visibleOnly: Bool?
    public var pageModel: ModelRef?
    public var selectionModel: ModelRef?

    public init(prePrompt: String? = nil, targetLang: String? = nil, displayMode: DisplayMode? = nil, visibleOnly: Bool? = nil, pageModel: ModelRef? = nil, selectionModel: ModelRef? = nil) {
        self.prePrompt = prePrompt
        self.targetLang = targetLang
        self.displayMode = displayMode
        self.visibleOnly = visibleOnly
        self.pageModel = pageModel
        self.selectionModel = selectionModel
    }
}

public struct Template: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var builtin: Bool
    public var settings: TemplateSettings

    public init(id: String, name: String, builtin: Bool, settings: TemplateSettings) {
        self.id = id
        self.name = name
        self.builtin = builtin
        self.settings = settings
    }
}

public struct ProfileOverride: Codable, Hashable, Sendable {
    public var text: String
    public var base: String
    public var savedAt: Double

    public init(text: String, base: String, savedAt: Double) {
        self.text = text
        self.base = base
        self.savedAt = savedAt
    }
}

public struct PortableGlobals: Codable, Hashable, Sendable {
    public var sourceLang: String
    public var targetLang: String
    public var languagePromptEnabled: Bool
    public var languageProfile: String
    public var defaultTemplateId: String

    public init(sourceLang: String, targetLang: String, languagePromptEnabled: Bool, languageProfile: String, defaultTemplateId: String) {
        self.sourceLang = sourceLang
        self.targetLang = targetLang
        self.languagePromptEnabled = languagePromptEnabled
        self.languageProfile = languageProfile
        self.defaultTemplateId = defaultTemplateId
    }
}
