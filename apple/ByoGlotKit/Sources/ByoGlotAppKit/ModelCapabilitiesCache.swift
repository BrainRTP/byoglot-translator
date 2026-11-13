import ByoGlotCore
import Foundation

public actor ModelCapabilitiesCache {
    public static let shared = ModelCapabilitiesCache()
    private var entries: [String: Entry] = [:]

    private struct Entry: CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
        let preset: ProviderPreset
        let baseUrl: String
        let secret: String?
        let models: [ModelInfo]
        var description: String { "ModelCapabilitiesCache.Entry" }
        var debugDescription: String { description }
        var customMirror: Mirror { Mirror(self, children: ["summary": description]) }
    }

    public init() {}

    public func record(_ models: [ModelInfo], connection: Connection, secret: String?) {
        entries[connection.id] = Entry(preset: connection.preset, baseUrl: connection.baseUrl, secret: secret, models: models)
    }

    func remove(connectionId: String) { entries[connectionId] = nil }

    func clamp(_ model: ModelRef, connection: Connection, secret: String?) -> ModelRef {
        guard let effort = model.variant, effort != "none", let entry = entries[connection.id], entry.preset == connection.preset, entry.baseUrl == connection.baseUrl, entry.secret == secret else { return model }
        if entry.models.contains(where: { $0.id == model.id && $0.variants.contains(effort) }) { return model }
        var clamped = model
        clamped.variant = "none"
        return clamped
    }
}
