import ByoGlotCore
import Foundation

public struct TemplateDraft: Codable, Equatable, Sendable {
    public private(set) var base: Template?
    public var value: Template

    public init(template: Template? = nil) {
        base = template
        value = template ?? Template(id: UUID().uuidString, name: "", builtin: false, settings: TemplateSettings())
    }

    public mutating func rebase(on latest: Template) {
        guard base != latest, latest.id == value.id else { return }
        value = applyingChanges(to: latest)
        base = latest
    }

    public func applyingChanges(to latest: Template) -> Template {
        guard let base, latest.id == value.id else { return value }
        var result = latest
        if value.name != base.name { result.name = value.name }
        if value.settings.prePrompt != base.settings.prePrompt { result.settings.prePrompt = value.settings.prePrompt }
        if value.settings.targetLang != base.settings.targetLang { result.settings.targetLang = value.settings.targetLang }
        if value.settings.pageModel != base.settings.pageModel { result.settings.pageModel = value.settings.pageModel }
        if value.settings.selectionModel != base.settings.selectionModel { result.settings.selectionModel = value.settings.selectionModel }
        if value.settings.displayMode != base.settings.displayMode { result.settings.displayMode = value.settings.displayMode }
        if value.settings.visibleOnly != base.settings.visibleOnly { result.settings.visibleOnly = value.settings.visibleOnly }
        return result
    }
}
