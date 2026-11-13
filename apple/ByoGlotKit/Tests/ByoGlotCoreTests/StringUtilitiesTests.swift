import Foundation
import Testing
@testable import ByoGlotCore

struct StringUtilitiesTests {
    @Test(arguments: [
        0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680,
        0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
        0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
    ])
    func trimsECMAScriptWhitespace(_ codePoint: Int) {
        let padding = String(Unicode.Scalar(codePoint)!)
        #expect(jsTrim(padding + "text" + padding) == "text")
    }

    @Test(arguments: [0x0085, 0x180e, 0x200b])
    func preservesCharactersJavaScriptDoesNotTrim(_ codePoint: Int) {
        let padding = String(Unicode.Scalar(codePoint)!)
        let text = padding + "text" + padding
        #expect(jsTrim(text) == text)
    }

    @Test func promptContextAndProfilesUseJavaScriptTrimming() {
        let empty = TextPromptInput(prePrompt: "", languagePrompt: "", sourceLang: "auto", targetLang: "ru", text: "hello", context: "", appName: "")
        var padded = empty
        padded.prePrompt = "\u{feff}"
        padded.languagePrompt = "\u{feff}"
        padded.appName = "\u{feff}"
        padded.context = "\u{feff}"
        #expect(PromptBuilder.text(padded) == PromptBuilder.text(empty))
        padded.context = "\u{0085}"
        #expect(PromptBuilder.text(padded).contains("CONTEXT (do not translate):\n\u{0085}"))
        let same = ProfileOverride(text: "\u{feff}rules\u{feff}", base: "rules", savedAt: 1)
        let different = ProfileOverride(text: "\u{0085}rules\u{0085}", base: "rules", savedAt: 1)
        #expect(LanguageProfiles.text(enabled: true, profile: "ru", targetLang: "ru", builtins: ["ru": "rules"], overrides: ["ru": same]) == "rules")
        #expect(LanguageProfiles.text(enabled: true, profile: "ru", targetLang: "ru", builtins: ["ru": "rules"], overrides: ["ru": different]) == different.text)
    }
    @Test(arguments: ["\u{feff}", "\u{0085}"])
    func retryAfterUsesJavaScriptTrimming(_ padding: String) async throws {
        let transport = RecordingTransport(HTTPResponse(status: 429, headers: ["Retry-After": padding + "1.5" + padding], body: Data("{}".utf8)))
        let client = ProviderClient(connection: Connection(id: "c1", preset: .custom, name: "Rate limit", baseUrl: "https://models.example.com"), secret: nil, transport: transport)
        do {
            _ = try await client.listModels()
            Issue.record("Expected rate limit")
        } catch {
            let delay: Int? = padding == "\u{feff}" ? 1500 : nil
            #expect(error == BackendError(kind: .rateLimit, status: 429, retryAfterMs: delay))
        }
    }

}
