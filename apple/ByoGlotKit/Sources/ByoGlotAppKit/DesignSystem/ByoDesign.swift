import SwiftUI
import Observation
import os
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

public enum ByoColor {
    public static let background = adaptive(0xffffff, 0x16181b)
    public static let surface = adaptive(0xf5f6f7, 0x1d2024)
    public static let border = adaptive(0xd9dce0, 0x33373d)
    public static let strongBorder = adaptive(0x8a929c, 0x6c737d)
    public static let text = adaptive(0x14171a, 0xeceef0)
    public static let muted = adaptive(0x566070, 0xa3aab4)
    public static let accent = adaptive(0x1d5bd1, 0x7aa7ff)
    public static let accentForeground = adaptive(0xffffff, 0x0b1220)
    public static let success = adaptive(0x17703f, 0x4cc38a)
    public static let error = adaptive(0xb3261e, 0xff8f86)
    public static let errorSurface = adaptive(0xfcedec, 0x2b1c1c)
    public static let warning = adaptive(0x8a5300, 0xf0b84a)
    public static let warningSurface = adaptive(0xfff4e0, 0x2b2314)
    public static let stage = adaptive(0xe8eaed, 0x0a0b0c)

    public static let accentTint = adaptive(0x1d5bd1, 0x7aa7ff, lightAlpha: 0.09, darkAlpha: 0.12)
    public static let scrim = adaptive(0x14171a, 0x000000, lightAlpha: 0.4, darkAlpha: 0.6)
    public static let shadow = adaptive(0x14171a, 0x000000, lightAlpha: 0.14, darkAlpha: 0.5)

    private static func adaptive(_ light: UInt, _ dark: UInt, lightAlpha: Double = 1, darkAlpha: Double = 1) -> Color {
        #if canImport(UIKit)
        Color(uiColor: UIColor { traits in
            let isDark = traits.userInterfaceStyle == .dark
            let hex = isDark ? dark : light
            return UIColor(red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255, alpha: isDark ? darkAlpha : lightAlpha)
        })
        #else
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            let hex = isDark ? dark : light
            return NSColor(red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255, alpha: isDark ? darkAlpha : lightAlpha)
        })
        #endif
    }
}

public enum ByoSpace {
    public static let tiny: CGFloat = 4
    public static let small: CGFloat = 8
    public static let inset: CGFloat = 12
    public static let screen: CGFloat = 16
    public static let paragraph: CGFloat = 20
    public static let block: CGFloat = 24
}

public enum ByoRadius {
    public static let segment: CGFloat = 4
    public static let control: CGFloat = 6
    public static let group: CGFloat = 8
    public static let panel: CGFloat = 10
    public static let sheet: CGFloat = 16
}

public enum AppStrings {
    public static let interfaceLanguageKey = "ByoGlotInterfaceLanguage"
    public static var interfaceLanguage: String { InterfaceLocale.shared.value }
    public static var locale: Locale { interfaceLanguage == "system" ? .current : Locale(identifier: interfaceLanguage) }
    public static func text(_ key: String) -> String {
        let code = interfaceLanguage == "system" ? Bundle.module.preferredLocalizations.first ?? "en" : interfaceLanguage
        let bundle = Bundle.module.path(forResource: code, ofType: "lproj").flatMap(Bundle.init(path:)) ?? .module
        return bundle.localizedString(forKey: key, value: nil, table: nil)
    }
    public static func error(_ error: RunnerError) -> String {
        var resource = UserFacingError.message(error)
        resource.locale = locale
        return String(localized: resource)
    }
    public static func format(_ key: String, _ values: [String: String]) -> String {
        values.reduce(text(key)) { $0.replacingOccurrences(of: "{\($1.key)}", with: $1.value) }
    }
    public static func effort(_ value: String?) -> String {
        let value = value ?? "none"
        return ["none", "low", "medium", "high", "max"].contains(value) ? text("effort." + value) : value
    }
    public static func profile(_ id: String) -> String {
        switch id {
        case "auto": text("profile.auto")
        case "generic": text("profile.generic")
        default: language(id)
        }
    }
    public static func language(_ code: String) -> String {
        locale.localizedString(forLanguageCode: code) ?? code
    }
}

public struct ByoTypography: ViewModifier {
    @ScaledMetric private var size: CGFloat
    private let weight: Font.Weight
    private let mono: Bool
    public init(_ size: CGFloat = 16, relativeTo: Font.TextStyle = .body, weight: Font.Weight = .regular, mono: Bool = false) {
        _size = ScaledMetric(wrappedValue: size, relativeTo: relativeTo)
        self.weight = weight
        self.mono = mono
    }
    public func body(content: Content) -> some View {
        content.font(.system(size: size, weight: weight, design: mono ? .monospaced : .default))
    }
}

struct ByoFocusRing: ViewModifier {
    @Environment(\.isFocused) private var focused
    func body(content: Content) -> some View {
        content.overlay {
            if focused { RoundedRectangle(cornerRadius: 6).stroke(ByoColor.accent, lineWidth: 2).padding(-2) }
        }
    }
}

final class InterfaceLocale: Observable, @unchecked Sendable {
    static let shared = InterfaceLocale()
    private let registrar = ObservationRegistrar()
    private let state = OSAllocatedUnfairLock(initialState: UserDefaults.standard.string(forKey: AppStrings.interfaceLanguageKey) ?? "system")
    var value: String {
        registrar.access(self, keyPath: \.value)
        return state.withLock { $0 }
    }
    @MainActor func set(_ value: String) {
        registrar.withMutation(of: self, keyPath: \.value) {
            state.withLock { $0 = value }
        }
    }
}
