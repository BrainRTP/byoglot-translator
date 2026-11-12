import Foundation

public struct TextPromptInput: Codable, Sendable {
    public var prePrompt: String
    public var languagePrompt: String
    public var sourceLang: String
    public var targetLang: String
    public var text: String
    public var context: String
    public var appName: String

    public init(prePrompt: String, languagePrompt: String, sourceLang: String, targetLang: String, text: String, context: String, appName: String) {
        self.prePrompt = prePrompt
        self.languagePrompt = languagePrompt
        self.sourceLang = sourceLang
        self.targetLang = targetLang
        self.text = text
        self.context = context
        self.appName = appName
    }
}

public enum PromptBuilder: Sendable {
    public static func text(_ i: TextPromptInput) -> String {
        let hasContext = !jsTrim(i.context).isEmpty
        var rules = [
            "You are a translation assistant.",
            "A reader selected the TEXT below and wants to understand it. Translate the TEXT from \(Contracts.languageName(i.sourceLang)) to \(Contracts.languageName(i.targetLang)).",
            "The TEXT can be a single word, a phrase, a sentence or a paragraph. Translate exactly this fragment and keep its form: a term stays a term, a phrase stays a phrase, a sentence stays a sentence. Start with a lowercase letter unless the fragment starts a sentence or is a name.",
        ]
        if hasContext {
            rules.append("CONTEXT is the text around the selection. Do not translate it, but use it to pick the meaning that fits, especially for short terms.")
        }
        rules.append("The answer is shown to a human as plain text or simple markdown. Do not wrap it in JSON or code fences, do not repeat the source text and do not add notes unless the user instructions ask for them. The user instructions below control wording, style and any extra explanations.")
        var parts = [rules.joined(separator: "\n")]
        let language = jsTrim(i.languagePrompt)
        if !language.isEmpty {
            parts.append("LANGUAGE STYLE (the user instructions below override it):\n\(language)")
        }
        let instructions = jsTrim(i.prePrompt)
        parts.append("USER INSTRUCTIONS:\n\(instructions.isEmpty ? "(none)" : instructions)")
        let appName = jsTrim(i.appName)
        if !appName.isEmpty { parts.append("The text comes from the app \(appName).") }
        if hasContext { parts.append("CONTEXT (do not translate):\n\(i.context)") }
        parts.append("TEXT:\n\(i.text)")
        return parts.joined(separator: "\n\n")
    }
}
