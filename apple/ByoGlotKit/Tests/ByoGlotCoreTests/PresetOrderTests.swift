import Foundation
import Testing
@testable import ByoGlotCore

struct PresetOrderTests {
    @Test func readsOnlyKeysOfTheTopLevelPresetsObjectInOrder() {
        let data = Data(#"{"metadata":{"deepseek":true},"presets":{"openai":{"mistral":true},"mistral":{},"deepseek":{}}}"#.utf8)
        #expect(Contracts.presetOrder(in: data) == [.openai, .mistral, .deepseek, .openrouter, .ollama, .lmstudio, .custom])
    }

    @Test(arguments: ["invalid", "{}", "{\"presets\":null}", "{\"presets\":{}}"])
    func missingOrInvalidDataFallsBackWithoutCrashing(_ json: String) {
        #expect(Contracts.presetOrder(in: Data(json.utf8)) == ProviderPreset.allCases)
    }
}
