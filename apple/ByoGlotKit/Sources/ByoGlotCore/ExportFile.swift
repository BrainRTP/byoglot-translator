import Foundation

public struct SiteRule: Codable, Hashable, Sendable {
    public var id: String
    public var pattern: String
    public var templateId: String

    public init(id: String, pattern: String, templateId: String) {
        self.id = id
        self.pattern = pattern
        self.templateId = templateId
    }
}

public struct ExportConnection: Codable, Hashable, Sendable {
    public var id: String
    public var preset: ProviderPreset
    public var name: String
    public var baseUrl: String

    public init(id: String, preset: ProviderPreset, name: String, baseUrl: String) {
        self.id = id
        self.preset = preset
        self.name = name
        self.baseUrl = baseUrl
    }
}

public struct ExportFile: Codable, Hashable, Sendable {
    public var format: String
    public var version: Int
    public var exportedAt: String
    public var globals: PortableGlobals
    public var templates: [Template]
    public var profileOverrides: [String: ProfileOverride]
    public var siteRules: [SiteRule]
    public var connections: [ExportConnection]

    public init(format: String, version: Int, exportedAt: String, globals: PortableGlobals, templates: [Template], profileOverrides: [String: ProfileOverride], siteRules: [SiteRule], connections: [ExportConnection]) {
        self.format = format
        self.version = version
        self.exportedAt = exportedAt
        self.globals = globals
        self.templates = templates
        self.profileOverrides = profileOverrides
        self.siteRules = siteRules
        self.connections = connections
    }

    public static func decode(_ data: Data) throws -> ExportFile {
        try JSONDecoder().decode(Self.self, from: data)
    }

    private enum CodingKeys: CodingKey {
        case format, version, exportedAt, globals, templates, profileOverrides, siteRules, connections
    }

    public init(from decoder: any Decoder) throws {
        let raw = try JSONValue(from: decoder)
        guard ExportShape.file.matches(raw) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid portable export"))
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        format = try c.decode(String.self, forKey: .format)
        version = try c.decode(Int.self, forKey: .version)
        exportedAt = try c.decode(String.self, forKey: .exportedAt)
        globals = try c.decode(PortableGlobals.self, forKey: .globals)
        templates = try c.decode([Template].self, forKey: .templates)
        profileOverrides = try c.decode([String: ProfileOverride].self, forKey: .profileOverrides)
        siteRules = try c.decode([SiteRule].self, forKey: .siteRules)
        connections = try c.decode([ExportConnection].self, forKey: .connections)
    }
}

private indirect enum ExportShape: Sendable {
    case string, number, bool, timestamp
    case oneOf([JSONValue])
    case array(ExportShape), dictionary(ExportShape)
    case object(required: [String: ExportShape], optional: [String: ExportShape] = [:])

    static let model: ExportShape = .object(required: ["providerID": .string, "id": .string], optional: ["variant": .string, "connectionId": .string])
    static let file: ExportShape = .object(required: [
        "format": .oneOf([.string("byoglot-export")]),
        "version": .oneOf([.number(1)]),
        "exportedAt": .timestamp,
        "globals": .object(required: ["sourceLang": .string, "targetLang": .string, "languagePromptEnabled": .bool, "languageProfile": .string, "defaultTemplateId": .string]),
        "templates": .array(.object(required: [
            "id": .string, "name": .string, "builtin": .bool,
            "settings": .object(required: [:], optional: [
                "prePrompt": .string, "targetLang": .string,
                "displayMode": .oneOf([.string("replace"), .string("bilingual")]),
                "visibleOnly": .bool, "pageModel": model, "selectionModel": model,
            ]),
        ])),
        "profileOverrides": .dictionary(.object(required: ["text": .string, "base": .string, "savedAt": .number])),
        "siteRules": .array(.object(required: ["id": .string, "pattern": .string, "templateId": .string])),
        "connections": .array(.object(required: ["id": .string, "preset": .oneOf(ProviderPreset.allCases.map { .string($0.rawValue) }), "name": .string, "baseUrl": .string])),
    ])

    func matches(_ value: JSONValue) -> Bool {
        switch (self, value) {
        case (.string, .string), (.number, .number), (.bool, .bool): return true
        case (.timestamp, .string(let text)):
            let pattern = #"^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z))$"#
            return text.range(of: pattern, options: .regularExpression) != nil
        case (.oneOf(let allowed), _): return allowed.contains(value)
        case (.array(let shape), .array(let values)): return values.allSatisfy(shape.matches)
        case (.dictionary(let shape), .object(let values)): return values.values.allSatisfy(shape.matches)
        case (.object(let required, let optional), .object(let values)):
            guard required.keys.allSatisfy({ values[$0] != nil }) else { return false }
            return values.allSatisfy { key, value in (required[key] ?? optional[key])?.matches(value) == true }
        default: return false
        }
    }
}
