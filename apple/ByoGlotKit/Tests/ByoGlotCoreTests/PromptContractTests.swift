import Testing
@testable import ByoGlotCore

struct PromptContractTests {
    struct ProfileInput: Decodable, Sendable {
        let languagePromptEnabled: Bool
        let languageProfile: String
        let targetLang: String
        let builtins: [String: String]
        let overrides: [String: ProfileOverride]
    }

    @Test(arguments: try ContractsFolder.fixture("prompt-text", input: TextPromptInput.self, expected: String.self))
    func textPromptMatchesTheContract(_ c: ContractCase<TextPromptInput, String>) {
        #expect(PromptBuilder.text(c.input) == c.expected, "\(c.name)")
    }

    @Test(arguments: try ContractsFolder.fixture("language-profile", input: ProfileInput.self, expected: String.self))
    func languageProfileMatchesTheContract(_ c: ContractCase<ProfileInput, String>) {
        let i = c.input
        #expect(LanguageProfiles.text(enabled: i.languagePromptEnabled, profile: i.languageProfile, targetLang: i.targetLang, builtins: i.builtins, overrides: i.overrides) == c.expected, "\(c.name)")
    }
}
