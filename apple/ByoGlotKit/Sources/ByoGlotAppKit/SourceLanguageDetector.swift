import ByoGlotCore
import NaturalLanguage

public protocol SourceLanguageDetecting: Sendable {
    func detect(_ text: String) -> String?
}

public struct OnDeviceLanguageDetector: SourceLanguageDetecting {
    public init() {}

    public func detect(_ text: String) -> String? {
        let recognizer = NLLanguageRecognizer()
        recognizer.processString(text)
        return Self.language(hypotheses: Dictionary(uniqueKeysWithValues: recognizer.languageHypotheses(withMaximum: 10).map { ($0.key.rawValue, $0.value) }))
    }

    public static func language(hypotheses: [String: Double]) -> String? {
        guard let top = hypotheses.max(by: { $0.value < $1.value }), top.value >= 0.8 else { return nil }
        let code = LanguageProfiles.primaryLang(top.key)
        return Contracts.languageCodes.contains(code) ? code : nil
    }
}
