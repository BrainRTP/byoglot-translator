import ByoGlotCore

public struct LanguageSelection: Sendable, Equatable {
    public private(set) var targetLang: String
    public private(set) var templateId: String?

    public init(targetLang: String, templateId: String? = nil) {
        self.targetLang = targetLang
        self.templateId = templateId
    }

    @discardableResult
    public mutating func selectTemplate(_ template: Template) -> Bool {
        guard templateId != template.id else { return false }
        templateId = template.id
        if let target = template.settings.targetLang { targetLang = target }
        return true
    }

    @discardableResult
    public mutating func selectTarget(_ language: String) -> Bool {
        guard targetLang != language else { return false }
        targetLang = language
        return true
    }
}
