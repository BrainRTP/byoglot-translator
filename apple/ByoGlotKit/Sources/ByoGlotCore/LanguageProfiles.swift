import Foundation

public enum LanguageProfiles: Sendable {
    public static func primaryLang(_ code: String) -> String {
        String(code.prefix { $0 != "-" && $0 != "_" }).lowercased()
    }

    public static func text(enabled: Bool, profile: String, targetLang: String, builtins: [String: String], overrides: [String: ProfileOverride]) -> String {
        guard enabled else { return "" }
        let primary = primaryLang(targetLang)
        let own = profile == Contracts.genericProfileId || profile == primary
        let choice = own ? profile : "auto"
        let automatic = builtins[primary] != nil ? primary : Contracts.genericProfileId
        let id = builtins[choice] != nil ? choice : automatic
        let builtin = builtins[id] ?? ""
        if let override = overrides[id], jsTrim(override.text) != jsTrim(builtin) {
            return override.text
        }
        return builtin
    }
}
